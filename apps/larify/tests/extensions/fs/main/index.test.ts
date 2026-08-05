import { describe, expect, it } from 'vitest'
import {
  BuiltinExtensionSource,
  builtinModules,
  ExtensionHost
} from '../../../../src/shared/extension'

describe('FS extension', () => {
  it('discovers and registers its tools', async () => {
    const modules = Object.fromEntries(
      Object.entries(builtinModules).filter(([path]) =>
        path.replaceAll('\\', '/').includes('/extensions/fs/main/')
      )
    )
    const [loader] = await new BuiltinExtensionSource(modules).discover()
    const extension = await loader.load()
    const host = new ExtensionHost()

    expect(extension.name).toBe('fs')
    await host.activate(extension)

    for (const name of ['read', 'edit', 'write', 'list', 'glob', 'grep']) {
      expect(host.getTool('fs', name)).toBeDefined()
    }
  })
})
