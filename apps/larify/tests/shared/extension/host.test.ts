import { describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import { ExtensionHost } from '../../../src/main/core/extension'
import { defineService, type Extension } from '../../../src/shared/extension'

describe('ExtensionHost', () => {
  it('runs the extension lifecycle', async () => {
    const deactivate = vi.fn()
    const extension: Extension = {
      name: 'test',
      description: 'Test extension',
      activate: vi.fn(),
      deactivate
    }
    const host = new ExtensionHost()

    await host.activate(extension)
    await host.deactivate(extension.name)

    expect(deactivate).toHaveBeenCalledOnce()
  })

  it('ignores an extension that is not active', async () => {
    await expect(new ExtensionHost().deactivate('missing')).resolves.toBeUndefined()
  })

  it('wraps and lists registered tools consistently', async () => {
    const host = new ExtensionHost()
    await host.activate({
      name: 'files',
      description: 'Files',
      activate(app) {
        app.registerTool(
          'read',
          tool({
            description: 'Read',
            metadata: { eager: false },
            inputSchema: z.object({ path: z.string() })
          })
        )
        app.registerTool('write', tool({ inputSchema: z.object({}) }))
        app.registerTool('invalid', { inputSchema: {} } as never)
      }
    })

    expect(host.listPlugins()).toEqual([
      { name: 'files', description: 'Files', tools: 2, skills: 0 }
    ])
    expect(host.listTools('files', false)).toEqual([
      { name: 'files_read', description: 'Read' },
      { name: 'files_write' }
    ])
    expect(host.listTools('files', true)).toEqual([])
    expect(host.getTools().has('files_read')).toBe(true)
    expect(host.getTools().has('files_invalid')).toBe(false)
    expect(
      (host.getTool('files', 'read')!.inputSchema as z.ZodType).safeParse({
        path: 'a.txt',
        _title: 'Read file'
      }).success
    ).toBe(true)
  })

  it('hides extensions without model capabilities', async () => {
    const host = new ExtensionHost()
    await host.activate({
      name: 'service',
      description: 'Service only',
      activate() {}
    })

    expect(host.listPlugins()).toEqual([])
  })

  it('shares typed services between extensions', async () => {
    const service = defineService<{ value: number }>('test')
    const host = new ExtensionHost()
    await host.activate({
      name: 'provider',
      description: 'Provider',
      activate(app) {
        app.registerService(service, { value: 42 })
      }
    })

    let received: { value: number } | undefined
    await host.activate({
      name: 'consumer',
      description: 'Consumer',
      activate(app) {
        received = app.getService(service)
      }
    })

    expect(received).toEqual({ value: 42 })
  })
})
