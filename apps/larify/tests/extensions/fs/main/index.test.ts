import { describe, expect, it } from 'vitest'
import fsPlugin from '../../../../src/extensions/fs/main'
import { PluginHost } from '../../../../src/main/core/plugin'
import { Registry } from '../../../../src/main/infra/registry'

describe('FS extension', () => {
  it('registers its tools', async () => {
    const host = new PluginHost(new Registry())

    expect(fsPlugin.manifest.id).toBe('fs')
    await host.activate(fsPlugin)

    for (const name of ['read', 'edit', 'write', 'list', 'glob', 'grep']) {
      expect(host.getTools('fs')?.get(`fs_${name}`)).toBeDefined()
    }
  })
})
