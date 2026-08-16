import { watch, type FSWatcher } from 'chokidar'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileTypeFromFile } from 'file-type'
import { lookup } from 'mime-types'
import type { FileDescriptor, FileNode } from '../shared/types'
import { readDirectory } from './directory'
import { resolveWorkspace } from './workspace'

export class WorkspaceService {
  private readonly root: Promise<string>
  private watcher: FSWatcher | null = null

  constructor(root: string, onChange: (directory: string, path: string) => void) {
    this.root = this.initialize(root, onChange)
  }

  rootPath(): Promise<string> {
    return this.root
  }

  async list(directory?: string): Promise<FileNode[]> {
    const root = await this.root
    const target = directory ?? root
    const entries = await readDirectory(target)
    this.watcher?.add(target)
    return entries
  }

  async reveal(file: string): Promise<string[]> {
    const root = await this.root
    if (!path.isAbsolute(file)) throw new Error('File path must be absolute')
    const candidate = path.normalize(file)
    const target = await realpath(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return candidate
    })
    const relative = path.relative(root, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Path is outside the workspace')
    }
    const parts = relative.split(path.sep)
    return [
      ...parts.slice(0, -1).map((_, index) => path.join(root, ...parts.slice(0, index + 1))),
      target
    ]
  }

  async readFile(file: string): Promise<string> {
    const size = (await stat(file)).size
    if (size > 20 * 1024 * 1024) {
      throw new Error(`文件过大，无法预览（${(size / 1024 / 1024).toFixed(1)} MiB，最大 20 MiB）`)
    }
    return readFile(file, 'utf8')
  }

  async inspectFile(file: string): Promise<FileDescriptor> {
    const normalized = path.normalize(file)
    const detected = await fileTypeFromFile(normalized)
    return {
      binary: detected !== undefined,
      mime: detected?.mime ?? (lookup(normalized) || 'application/octet-stream'),
      path: normalized
    }
  }

  async dispose(): Promise<void> {
    await this.root.catch(() => undefined)
    await this.watcher?.close()
    this.watcher = null
  }

  private async initialize(
    root: string,
    onChange: (directory: string, path: string) => void
  ): Promise<string> {
    const resolved = await resolveWorkspace(root)
    this.watcher = watch(resolved, { atomic: true, depth: 0, ignoreInitial: true })
    this.watcher.on('all', (_event, changedPath) => {
      const normalized = path.normalize(changedPath)
      onChange(path.dirname(normalized), normalized)
    })
    return resolved
  }
}
