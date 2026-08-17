import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const disposeOrder: string[] = []
  return {
    disposeOrder,
    ipc: vi.fn(() => () => disposeOrder.push('ipc')),
    managers: [] as Array<{
      dispose: ReturnType<typeof vi.fn>
      open: ReturnType<typeof vi.fn>
    }>,
    previews: [] as Array<{
      close: ReturnType<typeof vi.fn>
      dispose: ReturnType<typeof vi.fn>
      window: unknown
    }>
  }
})

vi.mock('../../../../src/extensions/workspace/main/manager', () => ({
  WorkspaceManager: class {
    dispose = vi.fn(() => harness.disposeOrder.push('manager'))
    open = vi.fn(() => ({ dispose: vi.fn() }))

    constructor() {
      harness.managers.push(this)
    }
  }
}))

vi.mock('../../../../src/extensions/workspace/main/native-preview-manager', () => ({
  NativePreviewManager: class {
    close = vi.fn()
    dispose = vi.fn(() => harness.disposeOrder.push('previews'))

    constructor(readonly window: unknown) {
      harness.previews.push(this)
    }
  }
}))

vi.mock('../../../../src/extensions/workspace/main/ipc', () => ({
  registerWorkspaceIpc: harness.ipc
}))

vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyWorkspacePath: () => 'D:\\default-workspace'
}))

import { resourceManagerToken } from '../../../../src/main/core/resource'
import { windowToken } from '../../../../src/main/window/token'
import plugin from '../../../../src/extensions/workspace/main/index'

const createWindow = (): {
  id: string
  webContents: {
    off: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }
} => ({
  id: 'main-window',
  webContents: { off: vi.fn(), on: vi.fn() }
})

describe('workspace main plugin', () => {
  beforeEach(() => {
    harness.disposeOrder.length = 0
    harness.managers.length = 0
    harness.previews.length = 0
    vi.clearAllMocks()
  })

  it('requires the resource manager and main window', () => {
    const subscriptions: unknown[] = []

    expect(() =>
      plugin.activate({ registry: { get: () => undefined }, subscriptions } as never)
    ).toThrow('ResourceManager is unavailable')

    expect(() =>
      plugin.activate({
        registry: { get: (token: unknown) => (token === resourceManagerToken ? {} : undefined) },
        subscriptions
      } as never)
    ).toThrow('MainWindow is unavailable')
  })

  it('retains the first registration for cleanup when the second registration fails', () => {
    const workspaceRegistration = { dispose: vi.fn() }
    const resources = {
      register: vi
        .fn()
        .mockReturnValueOnce(workspaceRegistration)
        .mockImplementationOnce(() => {
          throw new Error('changes already registered')
        })
    }
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
    const registry = {
      get: (token: unknown) =>
        token === resourceManagerToken ? resources : { get: () => createWindow() }
    }

    expect(() => plugin.activate({ registry, subscriptions } as never)).toThrow(
      'changes already registered'
    )
    expect(subscriptions).toHaveLength(4)
    expect(subscriptions.at(-1)).toBe(workspaceRegistration)
  })

  it('wires resources, previews and IPC to the same window', () => {
    const factories = new Map<
      string,
      (id: number, sessionId: string, options?: unknown) => unknown
    >()
    const resourceRegistration = { dispose: vi.fn(() => harness.disposeOrder.push('resource')) }
    const resources = {
      register: vi.fn(
        (type: string, next: (id: number, sessionId: string, options?: unknown) => unknown) => {
          factories.set(type, next)
          return resourceRegistration
        }
      )
    }
    const window = createWindow()
    const mainWindow = { get: vi.fn(() => window) }
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
    const registry = {
      get: (token: unknown) => {
        if (token === resourceManagerToken) return resources
        if (token === windowToken) return mainWindow
        return undefined
      }
    }

    plugin.activate({ registry, subscriptions } as never)

    expect(mainWindow.get).toHaveBeenCalledOnce()
    expect(resources.register).toHaveBeenCalledWith('workspace', expect.any(Function))
    expect(resources.register).toHaveBeenCalledWith('changes', expect.any(Function))
    expect(harness.previews[0].window).toBe(window)
    expect(harness.ipc).toHaveBeenCalledWith(harness.managers[0], harness.previews[0], window)
    expect(window.webContents.on).toHaveBeenCalledWith('did-start-navigation', expect.any(Function))

    factories.get('workspace')!(7, 'session', { root: 'D:\\custom' })
    factories.get('changes')!(8, 'session')
    expect(harness.managers[0].open).toHaveBeenNthCalledWith(1, 7, 'D:\\custom')
    expect(harness.managers[0].open).toHaveBeenNthCalledWith(2, 8, 'D:\\default-workspace')
  })

  it('closes the native preview when its workspace resource is disposed', async () => {
    let factory!: (
      id: number,
      sessionId: string,
      options?: unknown
    ) => {
      dispose(): void | Promise<void>
    }
    const workspaceDispose = vi.fn()
    const resources = {
      register: vi.fn((type: string, next: typeof factory) => {
        if (type === 'workspace') factory = next
        return { dispose: vi.fn() }
      })
    }
    const mainWindow = { get: () => createWindow() }
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
    const registry = {
      get: (token: unknown) => (token === resourceManagerToken ? resources : mainWindow)
    }
    plugin.activate({ registry, subscriptions } as never)
    harness.managers[0].open.mockReturnValueOnce({ dispose: workspaceDispose })

    await factory(7, 'session', { root: 'D:\\workspace' }).dispose()

    expect(harness.previews[0].close).toHaveBeenCalledWith(7)
    expect(workspaceDispose).toHaveBeenCalledOnce()

    const fallbackDispose = vi.fn()
    harness.managers[0].open.mockReturnValueOnce({ dispose: fallbackDispose })
    harness.previews[0].close.mockImplementationOnce(() => {
      throw new Error('preview close failed')
    })

    await expect(factory(8, 'session').dispose()).rejects.toThrow('preview close failed')
    expect(fallbackDispose).toHaveBeenCalledOnce()
  })

  it('disposes a changes resource through the shared workspace lifecycle', async () => {
    let factory!: (
      id: number,
      sessionId: string,
      options?: unknown
    ) => {
      dispose(): void | Promise<void>
    }
    const workspaceDispose = vi.fn()
    const resources = {
      register: vi.fn((type: string, next: typeof factory) => {
        if (type === 'changes') factory = next
        return { dispose: vi.fn() }
      })
    }
    const registry = {
      get: (token: unknown) =>
        token === resourceManagerToken ? resources : { get: () => createWindow() }
    }
    plugin.activate({ registry, subscriptions: [] } as never)
    harness.managers[0].open.mockReturnValueOnce({ dispose: workspaceDispose })

    await factory(9, 'session', { root: 'D:\\workspace' }).dispose()

    expect(harness.previews[0].close).toHaveBeenCalledWith(9)
    expect(workspaceDispose).toHaveBeenCalledOnce()
  })

  it('clears native previews only when the main frame fully navigates', () => {
    const resources = { register: vi.fn(() => ({ dispose: vi.fn() })) }
    const window = createWindow()
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
    const registry = {
      get: (token: unknown) => (token === resourceManagerToken ? resources : { get: () => window })
    }
    plugin.activate({ registry, subscriptions } as never)
    const listener = window.webContents.on.mock.calls[0][1]

    listener({}, 'file:///renderer.html', false, false)
    expect(harness.previews[0].dispose).not.toHaveBeenCalled()
    listener({}, 'file:///renderer.html#workspace', true, true)
    expect(harness.previews[0].dispose).not.toHaveBeenCalled()
    listener({}, 'file:///renderer.html', false, true)
    expect(harness.previews[0].dispose).toHaveBeenCalledOnce()

    subscriptions[2].dispose()
    expect(window.webContents.off).toHaveBeenCalledWith('did-start-navigation', listener)
  })

  it('registers subscriptions in safe reverse-disposal order', async () => {
    const resources = {
      register: vi.fn(() => ({ dispose: () => harness.disposeOrder.push('resource') }))
    }
    const mainWindow = { get: () => createWindow() }
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
    const registry = {
      get: (token: unknown) => (token === resourceManagerToken ? resources : mainWindow)
    }
    plugin.activate({ registry, subscriptions } as never)

    for (const subscription of [...subscriptions].reverse()) await subscription.dispose()

    expect(harness.disposeOrder).toEqual(['ipc', 'resource', 'resource', 'previews', 'manager'])
  })
})
