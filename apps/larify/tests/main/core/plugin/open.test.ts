import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import {
  PluginHost,
  type Plugin,
  pluginHostToken,
  registerPlugin
} from '../../../../src/main/core/plugin'

const mocks = vi.hoisted(() => ({
  plugins: [{ manifest: { id: 'builtin' }, activate: vi.fn() }] as Plugin[],
  loadPlugins: vi.fn()
}))

vi.mock('../../../../src/main/core/plugin/loader', () => ({
  discoverBuiltinPlugins: () => mocks.plugins,
  loadPlugins: mocks.loadPlugins
}))

describe('registerPlugin', () => {
  it('registers the application PluginHost and delegates builtin loading', async () => {
    const registry = new Registry()

    await registerPlugin({ registry } as never)
    const host = registry.get<PluginHost>(pluginHostToken)

    expect(host).toBeInstanceOf(PluginHost)
    expect(mocks.loadPlugins).toHaveBeenCalledWith(host, mocks.plugins)
  })
})
