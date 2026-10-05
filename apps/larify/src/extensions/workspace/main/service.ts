import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileTypeFromFile } from 'file-type'
import { lookup } from 'mime-types'
import type { FileDescriptor, FileNode } from '../shared/types'
import { readDirectory } from './directory'
import { resolveWorkspace } from './workspace'
import { workspaceWatcherPool, type WorkspaceWatcherSubscription } from './watcher-pool'

export class WorkspaceService {
  private readonly root: Promise<string>
  private subscription: WorkspaceWatcherSubscription | null = null
  private active: boolean

  constructor(root: string, onChange: (directory: string, path: string) => void, active = true) {
    this.active = active
    this.root = this.initialize(root, onChange)
    // 调用方可能稍后才 await（rootPath/dispose），先挂一个兜底 handler，
    // 避免根目录打开失败时产生未处理拒绝；真实错误仍由后续 await 抛出。
    void this.root.catch(() => undefined)
  }

  rootPath(): Promise<string> {
    return this.root
  }

  async list(directory?: string): Promise<FileNode[]> {
    const root = await this.root
    const target = directory ?? root
    await this.subscription?.add(target)
    return readDirectory(target)
  }

  async reveal(file: string): Promise<string[]> {
    const root = await this.root
    if (!path.isAbsolute(file)) throw new Error('File path must be absolute')
    const candidate = path.normalize(file)
    const target = await realpath(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return candidate
    })
    if (this.outside(root, target)) {
      throw new Error('Path is outside the workspace')
    }
    const parts = path.relative(root, target).split(path.sep)
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
    await this.watchFile(file)
    return readFile(file, 'utf8')
  }

  async readAsset(file: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const size = (await stat(file)).size
    if (size > 20 * 1024 * 1024) throw new Error('图片过大，无法预览')
    await this.watchFile(file)
    return {
      bytes: await readFile(file),
      mime: lookup(file) || 'application/octet-stream'
    }
  }

  async inspectFile(file: string): Promise<FileDescriptor> {
    const normalized = path.normalize(file)
    const detected = await fileTypeFromFile(normalized)
    await this.watchFile(normalized)
    return {
      binary: detected !== undefined,
      mime: detected?.mime ?? (lookup(normalized) || 'application/octet-stream'),
      path: normalized
    }
  }

  private async watchFile(file: string): Promise<void> {
    const root = await this.root.catch(() => null)
    if (root === null) return
    const directory = path.dirname(path.normalize(file))
    if (directory === root || this.outside(root, directory)) return
    await this.subscription?.add(directory)
  }

  private outside(root: string, target: string): boolean {
    const relative = path.relative(root, target)
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  }

  async dispose(): Promise<void> {
    await this.root.catch(() => undefined)
    await this.subscription?.dispose()
    this.subscription = null
  }

  async setActive(active: boolean): Promise<void> {
    this.active = active
    await this.root
    await this.subscription?.setActive(active)
  }

  private async initialize(
    root: string,
    onChange: (directory: string, path: string) => void
  ): Promise<string> {
    const resolved = await resolveWorkspace(root)
    const subscription = workspaceWatcherPool.acquire(
      resolved,
      (changedPath) => {
        const normalized = path.normalize(changedPath)
        onChange(path.dirname(normalized), normalized)
      },
      this.active
    )
    this.subscription = subscription
    await subscription.add(resolved)
    return resolved
  }
}
