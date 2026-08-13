import { watch, type EmitArgsWithName, type FSWatcher } from 'chokidar'
import type { FileInfo } from '../shared/types'
import { readDirectory } from './directory'
import { resolveWorkspace } from './workspace'

export class WorkspaceService {
  private readonly root: Promise<string>
  private watcher: FSWatcher | null = null

  constructor(root: string, onChange: (event: EmitArgsWithName[0], path: string) => void) {
    this.root = this.initialize(root, onChange)
  }

  rootPath(): Promise<string> {
    return this.root
  }

  async list(directory?: string): Promise<FileInfo[]> {
    const root = await this.root
    const target = directory ?? root
    const entries = await readDirectory(target)
    this.watcher?.add(target)
    return entries
  }

  async dispose(): Promise<void> {
    await this.root.catch(() => undefined)
    await this.watcher?.close()
    this.watcher = null
  }

  private async initialize(
    root: string,
    onChange: (event: EmitArgsWithName[0], path: string) => void
  ): Promise<string> {
    const resolved = await resolveWorkspace(root)
    this.watcher = watch(resolved, { atomic: true, depth: 0, ignoreInitial: true })
    this.watcher.on('all', onChange)
    return resolved
  }
}
