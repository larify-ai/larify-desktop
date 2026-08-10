import { describe, expect, it } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import {
  PluginHost,
  pluginHostToken,
  registerPlugin
} from '../../../../src/main/core/plugin'

describe('registerPlugin', () => {
  it('registers the application PluginHost and loads built-ins', async () => {
    const registry = new Registry()

    await registerPlugin({ registry } as never)
    const host = registry.get<PluginHost>(pluginHostToken)

    expect(host).toBeInstanceOf(PluginHost)
    expect(host?.has('agent')).toBe(true)
  })
})
