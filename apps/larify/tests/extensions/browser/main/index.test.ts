import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { ResourceManager, resourceManagerToken } from '../../../../src/main/core/resource'
import { windowToken } from '../../../../src/main/window/token'

const h = vi.hoisted(() => ({
  destroy: vi.fn(),
  unregisterIpc: vi.fn(),
  tools: { browse: { inputSchema: {} } }
}))

vi.mock('../../../../src/extensions/browser/main/browser-service', () => ({
  BrowserService: class { destroy = h.destroy }
}))
vi.mock('../../../../src/extensions/browser/main/ipc', () => ({
  registerBrowserIpc: () => h.unregisterIpc
}))
vi.mock('../../../../src/extensions/browser/main/tools', () => ({
  createBrowserTools: () => h.tools
}))

import plugin from '../../../../src/extensions/browser/main'

describe('browser plugin', () => {
  it('registers resources, IPC, tools and their cleanup', async () => {
    const registry = new Registry()
    registry.register(resourceManagerToken, new ResourceManager())
    registry.register(windowToken, { get: () => ({}) })
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
    const registerTool = vi.fn()
    await plugin.activate({ registry, subscriptions, registerTool } as never)
    expect(registerTool).toHaveBeenCalledWith('browse', h.tools.browse)
    for (const subscription of subscriptions) await subscription.dispose()
    expect(h.unregisterIpc).toHaveBeenCalledOnce()
    expect(h.destroy).toHaveBeenCalledOnce()
  })
})
