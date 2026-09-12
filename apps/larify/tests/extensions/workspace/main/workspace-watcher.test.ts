import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chokidar = vi.hoisted(() => {
  const watchers: Array<{
    _closers: Map<string, unknown[]>
    add: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    emit(event: string, value: unknown): void
    off: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    unwatch: ReturnType<typeof vi.fn>
  }> = []
  const api = {
    closeError: null as Error | null,
    readyError: null as Error | null,
    watchers,
    watch: vi.fn((root: string) => {
      const listeners = new Map<string, (...args: unknown[]) => void>()
      const onceListeners = new Map<string, (...args: unknown[]) => void>()
      const watched = new Set([root])
      const closers = new Map<string, unknown[]>([[root, [() => undefined]]])
      const watcher = {
        _closers: closers,
        add: vi.fn((items: string | string[]) => {
          for (const item of Array.isArray(items) ? items : [items]) {
            watched.add(item)
            queueMicrotask(() => closers.set(item, [() => undefined]))
          }
        }),
        close: vi.fn(async () => {
          if (api.closeError) throw api.closeError
        }),
        emit: (event: string, value: unknown): void => {
          listeners.get(event)?.(value)
          if (event !== 'error' && event !== 'ready') listeners.get('all')?.(event, value)
          const once = onceListeners.get(event)
          onceListeners.delete(event)
          once?.(value)
        },
        off: vi.fn((name: string, next: (...args: unknown[]) => void) => {
          if (listeners.get(name) === next) listeners.delete(name)
          if (onceListeners.get(name) === next) onceListeners.delete(name)
        }),
        on: vi.fn((name: string, next: (...args: unknown[]) => void) => {
          listeners.set(name, next)
        }),
        once: vi.fn((name: string, next: (...args: unknown[]) => void) => {
          onceListeners.set(name, next)
          if (name === 'ready') {
            queueMicrotask(() =>
              api.readyError
                ? watcher.emit('error', api.readyError)
                : watcher.emit('ready', undefined)
            )
          }
        }),
        unwatch: vi.fn(async (items: string | string[]) => {
          for (const item of Array.isArray(items) ? items : [items]) {
            watched.delete(item)
            closers.delete(item)
          }
        })
      }
      watchers.push(watcher)
      return watcher
    })
  }
  return api
})

vi.mock('chokidar', () => ({ watch: chokidar.watch }))

import { WorkspaceService } from '../../../../src/extensions/workspace/main/service'

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'larify-workspace-watcher-'))
  roots.push(root)
  return root
}

beforeEach(() => {
  chokidar.closeError = null
  chokidar.readyError = null
  chokidar.watchers.length = 0
  vi.clearAllMocks()
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('WorkspaceService watcher', () => {
  it('watches the root and directories as they are listed', async () => {
    const root = await createRoot()
    const child = path.join(root, 'child')
    await mkdir(child)
    const service = new WorkspaceService(root, () => undefined)
    await service.rootPath()
    await service.list(child)

    expect(chokidar.watch).toHaveBeenCalledWith(root, {
      atomic: true,
      depth: 0,
      ignoreInitial: true
    })
    expect(chokidar.watch).toHaveBeenCalledWith(child, {
      atomic: true,
      depth: 0,
      ignoreInitial: true
    })
    await service.dispose()
  })

  it('forwards changes and closes its watcher when disposed', async () => {
    const root = await createRoot()
    const onChange = vi.fn()
    const service = new WorkspaceService(root, onChange)

    await service.rootPath()
    chokidar.watchers[0].emit('change', path.join(root, 'file.ts'))
    await service.dispose()

    expect(onChange).toHaveBeenCalledWith(root, path.join(root, 'file.ts'))
    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()
  })

  it('normalizes changed paths at the watcher boundary', async () => {
    const root = await createRoot()
    const onChange = vi.fn()
    const service = new WorkspaceService(root, onChange)
    const changedPath = `${path.join(root, 'nested')}${path.sep}..${path.sep}file.ts`

    await service.rootPath()
    chokidar.watchers[0].emit('change', changedPath)

    const normalized = path.normalize(changedPath)
    expect(onChange).toHaveBeenCalledWith(path.dirname(normalized), normalized)
    await service.dispose()
  })

  it('can be disposed immediately after construction', async () => {
    const root = await createRoot()
    const service = new WorkspaceService(root, () => undefined)

    await service.dispose()

    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()
  })

  it('reports startup errors and closes the failed watcher', async () => {
    const root = await createRoot()
    chokidar.readyError = new Error('watch startup failed')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.rootPath()).rejects.toThrow('watch startup failed')

    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()
  })

  it('retains a failed startup watcher when closing it also fails', async () => {
    const root = await createRoot()
    chokidar.readyError = new Error('watch startup failed')
    chokidar.closeError = new Error('close failed')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.rootPath()).rejects.toThrow('Workspace watcher failed to start and close')
    chokidar.closeError = null
    await service.dispose()

    expect(chokidar.watchers[0].close).toHaveBeenCalledTimes(2)
  })

  it('shares one watcher for services using the same root', async () => {
    const root = await createRoot()
    const first = new WorkspaceService(root, () => undefined)
    const second = new WorkspaceService(root, () => undefined)

    await Promise.all([first.rootPath(), second.rootPath()])
    expect(chokidar.watch).toHaveBeenCalledOnce()

    await first.dispose()
    expect(chokidar.watchers[0].close).not.toHaveBeenCalled()

    await second.dispose()
    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()
  })

  it('shares and closes one watcher across many concurrent subscriptions', async () => {
    const root = await createRoot()
    const listeners = Array.from({ length: 50 }, () => vi.fn())
    const services = listeners.map((listener) => new WorkspaceService(root, listener))

    await Promise.all(services.map((service) => service.rootPath()))
    expect(chokidar.watch).toHaveBeenCalledOnce()

    const changed = path.join(root, 'file.ts')
    chokidar.watchers[0].emit('change', changed)
    expect(listeners.every((listener) => listener.mock.calls.length === 1)).toBe(true)

    await Promise.all(services.map((service) => service.dispose()))
    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()
  })

  it('serializes concurrent deactivate and reactivate transitions', async () => {
    const root = await createRoot()
    const first = new WorkspaceService(root, () => undefined)
    const second = new WorkspaceService(root, () => undefined)
    await Promise.all([first.rootPath(), second.rootPath()])

    await Promise.all([first.setActive(false), second.setActive(false)])
    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()

    await Promise.all([first.setActive(true), second.setActive(true)])
    expect(chokidar.watch).toHaveBeenCalledTimes(2)

    await Promise.all([first.dispose(), second.dispose()])
    expect(chokidar.watchers[1].close).toHaveBeenCalledOnce()
  })

  it('routes nested changes only to subscriptions watching that directory', async () => {
    const root = await createRoot()
    const child = path.join(root, 'child')
    await mkdir(child)
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const first = new WorkspaceService(root, firstChange)
    const second = new WorkspaceService(root, secondChange)
    await Promise.all([first.rootPath(), second.rootPath()])
    await first.list(child)

    const changed = path.join(child, 'file.ts')
    chokidar.watchers[1].emit('change', changed)

    expect(firstChange).toHaveBeenCalledWith(child, changed)
    expect(secondChange).not.toHaveBeenCalled()
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('isolates a failing change listener from other subscriptions', async () => {
    const root = await createRoot()
    const secondChange = vi.fn()
    const first = new WorkspaceService(root, () => {
      throw new Error('listener failed')
    })
    const second = new WorkspaceService(root, secondChange)
    await Promise.all([first.rootPath(), second.rootPath()])

    const changed = path.join(root, 'file.ts')
    expect(() => chokidar.watchers[0].emit('change', changed)).not.toThrow()

    expect(secondChange).toHaveBeenCalledWith(root, changed)
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('unwatches directories no longer used by an active subscription', async () => {
    const root = await createRoot()
    const child = path.join(root, 'child')
    await mkdir(child)
    const first = new WorkspaceService(root, () => undefined)
    const second = new WorkspaceService(root, () => undefined)
    await Promise.all([first.rootPath(), second.rootPath()])
    await first.list(child)

    await first.setActive(false)

    expect(chokidar.watchers[1].close).toHaveBeenCalledOnce()
    expect(chokidar.watchers[0].close).not.toHaveBeenCalled()
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('retries a failed directory watch on the next listing', async () => {
    const root = await createRoot()
    const child = path.join(root, 'child')
    await mkdir(child)
    const service = new WorkspaceService(root, () => undefined)
    await service.rootPath()
    chokidar.readyError = new Error('watch failed')

    await expect(service.list(child)).rejects.toThrow('watch failed')
    chokidar.readyError = null
    await expect(service.list(child)).resolves.toEqual([])

    expect(chokidar.watch).toHaveBeenCalledTimes(3)
    await service.dispose()
  })

  it('retries a failed directory watcher after its first cleanup also fails', async () => {
    const root = await createRoot()
    const child = path.join(root, 'child')
    await mkdir(child)
    const service = new WorkspaceService(root, () => undefined)
    await service.rootPath()
    chokidar.readyError = new Error('watch failed')
    chokidar.closeError = new Error('close failed')

    await expect(service.list(child)).rejects.toThrow('Workspace watcher failed to start and close')
    chokidar.readyError = null
    chokidar.closeError = null
    await expect(service.list(child)).resolves.toEqual([])

    expect(chokidar.watch).toHaveBeenCalledTimes(3)
    expect(chokidar.watchers[1].close).toHaveBeenCalledTimes(2)
    await service.dispose()
  })

  it('retries a failed unwatch when the inactive state is reconciled again', async () => {
    const root = await createRoot()
    const child = path.join(root, 'child')
    await mkdir(child)
    const first = new WorkspaceService(root, () => undefined)
    const second = new WorkspaceService(root, () => undefined)
    await Promise.all([first.rootPath(), second.rootPath()])
    await first.list(child)
    chokidar.watchers[1].close.mockRejectedValueOnce(new Error('unwatch failed'))

    await expect(first.setActive(false)).rejects.toThrow('unwatch failed')
    await expect(first.setActive(false)).resolves.toBeUndefined()

    expect(chokidar.watchers[1].close).toHaveBeenCalledTimes(2)
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('retains and retries a watcher when closing it fails', async () => {
    const root = await createRoot()
    const service = new WorkspaceService(root, () => undefined)
    await service.rootPath()
    chokidar.watchers[0].close.mockRejectedValueOnce(new Error('close failed'))

    await expect(service.setActive(false)).rejects.toThrow('close failed')
    await expect(service.setActive(false)).resolves.toBeUndefined()

    expect(chokidar.watchers[0].close).toHaveBeenCalledTimes(2)
    await service.dispose()
  })

  it('watches a file parent directory on inspect even when it was never listed', async () => {
    const root = await createRoot()
    const nested = path.join(root, 'src', 'deep')
    await mkdir(nested, { recursive: true })
    const file = path.join(nested, 'file.ts')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'export const value = 1')
    const onChange = vi.fn()
    const service = new WorkspaceService(root, onChange)

    // 不 list 任何目录，直接检查深层文件：应补齐其父目录监听。
    await expect(service.inspectFile(file)).resolves.toMatchObject({ path: file })

    expect(chokidar.watch).toHaveBeenCalledWith(nested, {
      atomic: true,
      depth: 0,
      ignoreInitial: true
    })

    const changed = path.join(nested, 'file.ts')
    chokidar.watchers.at(-1)?.emit('change', changed)
    expect(onChange).toHaveBeenCalledWith(nested, changed)
    await service.dispose()
  })

  it('does not watch directories outside the workspace on inspect', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const file = path.join(outside, 'outside.ts')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'value')
    const service = new WorkspaceService(root, () => undefined)

    await service.inspectFile(file)

    expect(chokidar.watch).toHaveBeenCalledTimes(1)
    expect(chokidar.watch).toHaveBeenCalledWith(root, expect.anything())
    await service.dispose()
  })

  it('watches a nested asset parent directory on read even when it was never listed', async () => {
    const root = await createRoot()
    const assets = path.join(root, 'docs', 'assets')
    await mkdir(assets, { recursive: true })
    const image = path.join(assets, 'logo.png')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(image, Buffer.from([1, 2, 3]))
    const service = new WorkspaceService(root, () => undefined)

    // 不 list 任何目录，直接读取 Markdown 内嵌图片：应补齐其父目录监听。
    await expect(service.readAsset(image)).resolves.toMatchObject({ mime: 'image/png' })

    expect(chokidar.watch).toHaveBeenCalledWith(assets, {
      atomic: true,
      depth: 0,
      ignoreInitial: true
    })
    await service.dispose()
  })

  it('does not watch directories outside the workspace on asset read', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const image = path.join(outside, 'outside.png')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(image, Buffer.from([1, 2, 3]))
    const service = new WorkspaceService(root, () => undefined)

    await service.readAsset(image)

    expect(chokidar.watch).toHaveBeenCalledTimes(1)
    expect(chokidar.watch).toHaveBeenCalledWith(root, expect.anything())
    await service.dispose()
  })

  it('watches the parent directory when inspecting before the root resolves', async () => {
    const root = await createRoot()
    const nested = path.join(root, 'src')
    await mkdir(nested, { recursive: true })
    const file = path.join(nested, 'file.ts')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'export const value = 1')
    const service = new WorkspaceService(root, () => undefined)

    // 不 await rootPath：inspect 紧随构造之后（manager.open 同步登记、initialize 异步完成），
    // watch 必须等待 initialize 完成，否则会漏掉父目录监听。
    await expect(service.inspectFile(file)).resolves.toMatchObject({ path: file })

    expect(chokidar.watch).toHaveBeenCalledWith(nested, {
      atomic: true,
      depth: 0,
      ignoreInitial: true
    })
    await service.dispose()
  })

  it('reads files and assets even when the workspace root cannot be opened', async () => {
    const missingRoot = path.join(await createRoot(), 'missing')
    const outside = await createRoot()
    const file = path.join(outside, 'note.txt')
    const image = path.join(outside, 'logo.png')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'note')
    await writeFile(image, Buffer.from([1, 2, 3]))
    const service = new WorkspaceService(missingRoot, () => undefined)

    await expect(service.readFile(file)).resolves.toBe('note')
    await expect(service.readAsset(image)).resolves.toMatchObject({ mime: 'image/png' })
    await expect(service.inspectFile(file)).resolves.toMatchObject({ path: file })
    // 消费 initialize 的失败，避免未处理拒绝；同时确认 rootPath 如实上报错误。
    await expect(service.rootPath()).rejects.toThrow()
  })

  it('normalizes a file path before watching its parent directory', async () => {
    const root = await createRoot()
    const nested = path.join(root, 'src', 'deep')
    await mkdir(nested, { recursive: true })
    const file = path.join(nested, 'file.ts')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'value')
    const service = new WorkspaceService(root, () => undefined)

    // 含 `..` 段的路径：父目录需先归一化再监听，否则会监听 `src/deep/..`。
    const unnormalized = `${file}${path.sep}..${path.sep}${path.basename(file)}`
    await service.inspectFile(unnormalized)

    expect(chokidar.watch).toHaveBeenCalledWith(nested, {
      atomic: true,
      depth: 0,
      ignoreInitial: true
    })
    await service.dispose()
  })

  it('does not watch the workspace root itself when inspecting a root file', async () => {
    const root = await createRoot()
    const file = path.join(root, 'readme.md')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, '# hi')
    const service = new WorkspaceService(root, () => undefined)

    await service.inspectFile(file)

    expect(chokidar.watch).toHaveBeenCalledTimes(1)
    await service.dispose()
  })

  it('closes a watcher while inactive and recreates it on resume', async () => {
    const root = await createRoot()
    const service = new WorkspaceService(root, () => undefined, false)

    await service.rootPath()
    expect(chokidar.watch).not.toHaveBeenCalled()

    await service.setActive(true)
    expect(chokidar.watch).toHaveBeenCalledOnce()

    await service.setActive(false)
    expect(chokidar.watchers[0].close).toHaveBeenCalledOnce()

    await service.setActive(true)
    expect(chokidar.watch).toHaveBeenCalledTimes(2)
    await service.dispose()
  })
})
