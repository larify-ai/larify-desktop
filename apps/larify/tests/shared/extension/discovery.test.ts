import { describe, expect, it, vi } from 'vitest'
import type { Extension } from '../../../src/shared/extension'
import {
  BuiltinExtensionSource,
  builtinExtensionSource,
  builtinModules,
  discoverExtensions,
  type ExtensionSource
} from '../../../src/main/core/extension'

const extension: Extension = {
  name: 'git',
  description: 'Git',
  activate: () => undefined
}

describe('extension discovery', () => {
  it('discovers built-in extensions without loading them', async () => {
    const load = vi.fn(async () => ({ default: extension }))
    const [loader] = await new BuiltinExtensionSource({
      '../extensions/git/main/index.ts': load
    }).discover()

    expect(load).not.toHaveBeenCalled()
    await expect(loader.load()).resolves.toBe(extension)
  })

  it('supports an empty built-in module map', async () => {
    await expect(new BuiltinExtensionSource({}).discover()).resolves.toEqual([])
  })

  it('preserves built-in module order', async () => {
    const first = { ...extension, name: 'first' }
    const second = { ...extension, name: 'second' }
    const loaders = await new BuiltinExtensionSource({
      first: async () => ({ default: first }),
      second: async () => ({ default: second })
    }).discover()

    await expect(Promise.all(loaders.map((loader) => loader.load()))).resolves.toEqual([
      first,
      second
    ])
  })

  it('propagates module loading failures', async () => {
    const error = new Error('load failed')
    const [loader] = await new BuiltinExtensionSource({
      broken: async () => {
        throw error
      }
    }).discover()

    await expect(loader.load()).rejects.toBe(error)
  })

  it('discovers the real built-in module map', async () => {
    const loaders = await builtinExtensionSource.discover()

    expect(loaders).toHaveLength(Object.keys(builtinModules).length)
    expect(loaders.length).toBeGreaterThan(0)
  })

  it('combines extension sources in source order', async () => {
    const source = (value: Extension): ExtensionSource => ({
      async discover() {
        return [{ load: async () => value }]
      }
    })
    const first = { ...extension, name: 'first' }
    const second = { ...extension, name: 'second' }

    const loaders = await discoverExtensions([source(first), source(second)])
    const extensions = await Promise.all(loaders.map((loader) => loader.load()))

    expect(extensions.map(({ name }) => name)).toEqual(['first', 'second'])
  })

  it('supports an empty source list', async () => {
    await expect(discoverExtensions([])).resolves.toEqual([])
  })

  it('discovers every source', async () => {
    const discover = vi.fn(async () => [])

    await discoverExtensions([{ discover }, { discover }])

    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('propagates source discovery failures', async () => {
    const error = new Error('discovery failed')
    const source: ExtensionSource = {
      async discover() {
        throw error
      }
    }

    await expect(discoverExtensions([source])).rejects.toBe(error)
  })
})
