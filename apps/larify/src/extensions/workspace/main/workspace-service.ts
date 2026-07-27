import { open, readdir, realpath, stat, writeFile, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { watch, type EmitArgsWithName, type FSWatcher } from 'chokidar'
import type { WorkspaceEntry, WorkspaceGitStatus } from '../shared/types'
import { GitService } from './git/git-service'

export class WorkspaceService {
  private root: string | null = null
  private watcher: FSWatcher | null = null
  private watchedDirectories = new Set<string>()
  private allowedFiles = new Set<string>()
  private readonly openFiles = new Map<number, FileHandle>()
  private nextFileHandle = 1
  private openQueue = Promise.resolve()
  private gitStatus: Promise<WorkspaceGitStatus> | null = null

  constructor(private readonly git = new GitService()) {}

  async open(
    root: string,
    onChange: (event: EmitArgsWithName[0], path: string) => void
  ): Promise<string> {
    const request = this.openQueue
      .catch(() => undefined)
      .then(() => this.openWorkspace(root, onChange))
    this.openQueue = request.then(
      () => undefined,
      () => undefined
    )
    return request
  }

  private async openWorkspace(
    root: string,
    onChange: (event: EmitArgsWithName[0], path: string) => void
  ): Promise<string> {
    const resolved = await realpath(root)
    if (!(await stat(resolved)).isDirectory()) throw new Error('Workspace path is not a directory')
    if (this.root === resolved && this.watcher) return resolved

    await this.watcher?.close()
    await this.closeOpenFiles()
    this.root = resolved
    this.watchedDirectories.clear()
    this.allowedFiles.clear()
    this.gitStatus = null
    this.watcher = watch([], {
      atomic: true,
      depth: 0,
      ignoreInitial: true
    })
    this.watcher.on('all', (event, changedPath) => {
      this.gitStatus = null
      onChange(event, changedPath)
    })
    this.watchDirectory(resolved)
    return resolved
  }

  async list(directory?: string): Promise<WorkspaceEntry[]> {
    const target = await this.resolveExisting(directory ?? this.requireRoot())
    const entries = await readdir(target, { withFileTypes: true })
    this.watchDirectory(target)
    return entries
      .filter((entry) => entry.name !== '.git' && (entry.isDirectory() || entry.isFile()))
      .map<WorkspaceEntry>((entry) => ({
        kind: entry.isDirectory() ? 'directory' : 'file',
        name: entry.name,
        path: path.join(target, entry.name)
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      })
  }

  async getGitStatuses(): Promise<WorkspaceGitStatus> {
    if (!this.root) return { available: false, message: 'No workspace is open' }
    this.gitStatus ??= this.loadGitStatuses(this.root)
    return this.gitStatus
  }

  async getGitOriginal(file: string): Promise<Uint8Array | null> {
    const root = this.requireRoot()
    const target = path.resolve(file)
    const relative = path.relative(root, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Path is outside the workspace')
    }
    return this.git.original(root, target)
  }

  async stat(candidate: string): Promise<{
    directory: boolean
    ctime: number
    mtime: number
    size: number
  }> {
    const metadata = await stat(await this.resolveExisting(candidate))
    return {
      directory: metadata.isDirectory(),
      ctime: metadata.ctimeMs,
      mtime: metadata.mtimeMs,
      size: metadata.size
    }
  }

  async openFile(file: string): Promise<number> {
    const target = await this.resolveExisting(file)
    if (!(await stat(target)).isFile()) throw new Error('Workspace entry is not a file')
    const handle = await open(target, 'r')
    const id = this.nextFileHandle++
    this.openFiles.set(id, handle)
    return id
  }

  async allowFile(file: string): Promise<string> {
    const target = await realpath(path.resolve(file))
    if (!(await stat(target)).isFile()) throw new Error('Workspace entry is not a file')
    this.allowedFiles.add(target)
    return target
  }

  async readFile(handleId: number, position: number, length: number): Promise<Uint8Array> {
    const handle = this.openFiles.get(handleId)
    if (!handle) throw new Error('Workspace file handle is closed')
    if (!Number.isSafeInteger(position) || position < 0) throw new Error('Invalid read position')
    if (!Number.isSafeInteger(length) || length < 1 || length > 1024 * 1024) {
      throw new Error('Invalid read length')
    }
    const buffer = new Uint8Array(length)
    const { bytesRead } = await handle.read(buffer, 0, length, position)
    return buffer.subarray(0, bytesRead)
  }

  async closeFile(handleId: number): Promise<void> {
    const handle = this.openFiles.get(handleId)
    if (!handle) return
    this.openFiles.delete(handleId)
    await handle.close()
  }

  async write(file: string, content: Uint8Array): Promise<void> {
    const target = await this.resolveExisting(file)
    if (!(await stat(target)).isFile()) throw new Error('Workspace entry is not a file')
    await writeFile(target, content)
    this.gitStatus = null
  }

  async dispose(): Promise<void> {
    await this.openQueue.catch(() => undefined)
    await this.watcher?.close()
    await this.closeOpenFiles()
    this.watcher = null
    this.watchedDirectories.clear()
    this.allowedFiles.clear()
    this.root = null
    this.gitStatus = null
  }

  private requireRoot(): string {
    if (!this.root) throw new Error('No workspace is open')
    return this.root
  }

  private async loadGitStatuses(root: string): Promise<WorkspaceGitStatus> {
    try {
      return { available: true, statuses: await this.git.status(root) }
    } catch (error) {
      return {
        available: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async closeOpenFiles(): Promise<void> {
    const handles = [...this.openFiles.values()]
    this.openFiles.clear()
    await Promise.allSettled(handles.map((handle) => handle.close()))
  }

  private watchDirectory(directory: string): void {
    if (!this.watcher || this.watchedDirectories.has(directory)) return
    this.watchedDirectories.add(directory)
    this.watcher.add(directory)
  }

  private async resolveExisting(candidate: string): Promise<string> {
    const root = this.requireRoot()
    const target = await realpath(path.resolve(candidate))
    const relative = path.relative(root, target)
    const outside =
      relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    if (outside && !this.allowedFiles.has(target)) {
      throw new Error('Path is outside the workspace')
    }
    return target
  }
}
