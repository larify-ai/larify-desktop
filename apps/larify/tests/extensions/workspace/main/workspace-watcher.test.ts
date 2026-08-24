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
