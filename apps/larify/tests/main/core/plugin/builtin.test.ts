import { describe, expect, it } from 'vitest'
import { discoverBuiltinPlugins } from '../../../../src/main/core/plugin/loader'

describe('discoverBuiltinPlugins', () => {
  it('returns built-in plugins in activation order', () => {
    expect(discoverBuiltinPlugins().map(({ manifest }) => manifest.id)).toEqual([
      'agent',
      'fs',
      'terminal',
      'browser',
      'workspace'
    ])
  })
})
