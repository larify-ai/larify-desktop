import { describe, expect, it } from 'vitest'
import {
  BuiltinExtensionSource,
  builtinModules,
  ExtensionHost
} from '../../../../src/shared/extension'
import extension, { gitService } from '../../../../src/extensions/git/main'
import { GitService } from '../../../../src/extensions/git/main/git-service'

describe('Git extension', () => {
  it('registers its service', async () => {
    const host = new ExtensionHost()

    await host.activate(extension)

    expect(host.getService(gitService)).toBeInstanceOf(GitService)
  })

  it('discovers and registers the built-in Git extension', async () => {
    const modules = Object.fromEntries(
      Object.entries(builtinModules).filter(([path]) =>
        path.replaceAll('\\', '/').includes('/extensions/git/main/')
      )
    )
    const [loader] = await new BuiltinExtensionSource(modules).discover()
    const discovered = await loader.load()
    const host = new ExtensionHost()

    expect(modules).toHaveProperty('../../../extensions/git/main/index.ts')
    expect(discovered.name).toBe('git')
    await host.activate(discovered)

    expect(host.getService(gitService)).toBeInstanceOf(GitService)
  })
})
