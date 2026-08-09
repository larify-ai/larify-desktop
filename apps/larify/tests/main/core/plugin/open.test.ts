import { describe, expect, it } from 'vitest'
import { Registry } from '../../../../src/main/infra/registry'
import {
  PluginHost,
  pluginHostToken,
  registerPlugin
} from '../../../../src/main/core/plugin'

describe('registerPlugin', () => {
  it('registers the application PluginHost', () => {
    const registry = new Registry()

    registerPlugin({ registry } as never)

    expect(registry.get(pluginHostToken)).toBeInstanceOf(PluginHost)
  })
})
