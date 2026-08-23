import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  ipc: vi.fn(() => vi.fn()),
  managers: [] as Array<{
    dispose: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('../../../../src/extensions/workspace/main/manager', () => ({
  WorkspaceManager: class {
    dispose = vi.fn()
    open = vi.fn(() => ({ dispose: vi.fn() }))
    constructor() {
      harness.managers.push(this)
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

const createWindow = (): { id: string } => ({ id: 'main-window' })

describe('workspace main plugin', () => {
  beforeEach(() => {
    harness.managers.length = 0
    vi.clearAllMocks()
  })

  it('requires the resource manager and main window', () => {
    expect(() =>
      plugin.activate({ registry: { get: () => undefined }, subscriptions: [] } as never)
    ).toThrow('ResourceManager is unavailable')
    expect(() =>
      plugin.activate({
        registry: { get: (token: unknown) => (token === resourceManagerToken ? {} : undefined) },
        subscriptions: []
      } as never)
    ).toThrow('MainWindow is unavailable')
  })

  it('registers workspace resources and IPC without a native preview manager', () => {
    const factories = new Map<
      string,
      (id: number, sessionId: string, options?: unknown) => { dispose(): unknown }
    >()
    const resources = {
      register: vi.fn(
        (
          type: string,
          factory: (id: number, sessionId: string, options?: unknown) => { dispose(): unknown }
        ) => {
          factories.set(type, factory)
          return { dispose: vi.fn() }
        }
      )
    }
    const window = createWindow()
    const registry = {
      get: (token: unknown) =>
        token === resourceManagerToken
          ? resources
          : token === windowToken
            ? { get: () => window }
            : undefined
    }
    const subscriptions: Array<{ dispose(): unknown }> = []

    plugin.activate({ registry, subscriptions } as never)

    expect(harness.ipc).toHaveBeenCalledWith(harness.managers[0], window)
    expect(resources.register).toHaveBeenCalledWith('workspace', expect.any(Function))
    expect(resources.register).toHaveBeenCalledWith('changes', expect.any(Function))
    const workspace = factories.get('workspace')!(7, 'session', { root: 'D:\\custom' })
    expect(harness.managers[0].open).toHaveBeenCalledWith(7, 'D:\\custom')
    expect(workspace).toBe(harness.managers[0].open.mock.results[0].value)
    const changes = factories.get('changes')!(8, 'session')
    expect(harness.managers[0].open).toHaveBeenLastCalledWith(8, 'D:\\default-workspace')
    expect(changes).toBe(harness.managers[0].open.mock.results[1].value)
    expect(subscriptions).toHaveLength(4)
  })
})
