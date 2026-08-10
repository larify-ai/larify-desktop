import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { PluginHost } from '../../../../src/main/core/plugin/host'
import { resourceManagerToken } from '../../../../src/main/core/resource'
import { windowToken } from '../../../../src/main/window/token'

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  registerIpc: vi.fn(),
  unregisterIpc: vi.fn()
}))

vi.mock('../../../../src/extensions/terminal/main/ipc', () => ({
  registerTerminalIpc: mocks.registerIpc
}))

vi.mock('../../../../src/extensions/terminal/main/terminal-service', () => ({
  TerminalService: class {
    destroy = mocks.destroy
  }
}))

vi.mock('../../../../src/extensions/terminal/main/tools', () => ({
  createTerminalToolkit: () => ({ list: { description: 'list' } })
}))

import terminalPlugin from '../../../../src/extensions/terminal/main'

beforeEach(() => {
  mocks.destroy.mockReset()
  mocks.unregisterIpc.mockReset()
  mocks.registerIpc.mockReset().mockReturnValue(mocks.unregisterIpc)
})

describe('terminal plugin', () => {
  it('uses application services and registers tools', async () => {
    const registry = new Registry()
    const resources = { application: 'resources' }
    const browserWindow = { application: 'window' }
    registry.register(resourceManagerToken, resources)
    registry.register(windowToken, { get: () => browserWindow })
    const registerTool = vi.fn()
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []

    await terminalPlugin.activate({ registry, registerTool, subscriptions } as never)

    expect(mocks.registerIpc).toHaveBeenCalledWith(expect.anything(), browserWindow)
    expect(registerTool).toHaveBeenCalledWith('list', { description: 'list' })

    for (const subscription of subscriptions.reverse()) await subscription.dispose()
    expect(mocks.unregisterIpc).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the service when activation fails after construction', async () => {
    const registry = new Registry()
    registry.register(resourceManagerToken, {})
    registry.register(windowToken, { get: () => ({}) })
    mocks.registerIpc.mockImplementation(() => {
      throw new Error('ipc failed')
    })
    const host = new PluginHost(registry)

    await expect(host.activate(terminalPlugin)).rejects.toThrow('ipc failed')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('unregisters ipc before destroying the service when tool registration fails', async () => {
    const registry = new Registry()
    registry.register(resourceManagerToken, {})
    registry.register(windowToken, { get: () => ({}) })
    const host = new PluginHost(registry)

    await expect(host.activate(terminalPlugin)).rejects.toThrow('Tool input schema')

    expect(mocks.unregisterIpc).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.unregisterIpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.destroy.mock.invocationCallOrder[0]
    )
  })
})
