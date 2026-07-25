import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { watch, type EmitArgsWithName, type FSWatcher } from 'chokidar'
import type { WorkspaceEntry } from '../shared/types'

export class WorkspaceService {
  private root: string | null = null
  private watcher: FSWatcher | null = null
  private watchedDirectories = new Set<string>()

  async open(
    root: string,
    onChange: (event: EmitArgsWithName[0], path: string) => void
  ): Promise<string> {
    const resolved = await realpath(root)
    if (!(await stat(resolved)).isDirectory()) throw new Error('Workspace path is not a directory')

    await this.watcher?.close()
    this.root = resolved
    this.watchedDirectories.clear()
    this.watcher = watch([], {
      atomic: true,
      depth: 0,
      ignoreInitial: true,
    })
    this.watcher.on('all', onChange)
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

  async read(file: string): Promise<Uint8Array> {
    const target = await this.resolveExisting(file)
    const metadata = await stat(target)
    if (!metadata.isFile()) throw new Error('Workspace entry is not a file')
    return readFile(target)
  }

  async write(file: string, content: Uint8Array): Promise<void> {
    const target = await this.resolveExisting(file)
    if (!(await stat(target)).isFile()) throw new Error('Workspace entry is not a file')
    await writeFile(target, content)
  }

  async dispose(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    this.watchedDirectories.clear()
    this.root = null
  }

  private requireRoot(): string {
    if (!this.root) throw new Error('No workspace is open')
    return this.root
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
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Path is outside the workspace')
    }
    return target
  }
}
