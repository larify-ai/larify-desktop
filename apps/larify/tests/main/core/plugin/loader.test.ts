import { describe, expect, it, vi } from 'vitest'
import { PluginHost, type Plugin } from '../../../../src/main/core/plugin'
import { loadPlugins } from '../../../../src/main/core/plugin/loader'
import { Registry } from '../../../../src/shared/infra/registry'
import { discoverBuiltinPlugins } from '../../../../src/main/core/plugin/loader/builtin'

describe('loadPlugins', () => {
  it('includes the terminal builtin', () => {
    expect(discoverBuiltinPlugins().map(({ manifest }) => manifest.id)).toContain('terminal')
  })

  it('loads plugins sequentially in the given order', async () => {
    const calls: string[] = []
    const plugin = (id: string): Plugin => ({
      manifest: { id },
      async activate() {
        calls.push(`${id}:start`)
        await Promise.resolve()
        calls.push(`${id}:end`)
      }
    })
    const host = new PluginHost(new Registry())

    await loadPlugins(host, [plugin('first'), plugin('second')])

    expect(calls).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
    expect(host.listPlugins().map(({ id }) => id)).toEqual(['first', 'second'])
  })

  it('continues loading after a plugin fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = new PluginHost(new Registry())

    await loadPlugins(host, [
      {
        manifest: { id: 'broken' },
        activate() {
          throw new Error('broken')
        }
      },
      { manifest: { id: 'working' }, activate: () => undefined }
    ])

    expect(host.has('broken')).toBe(false)
    expect(host.has('working')).toBe(true)
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
