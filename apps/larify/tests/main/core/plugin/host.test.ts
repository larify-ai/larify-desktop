import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineService, Registry } from '../../../../src/main/infra/registry'
import { defineTool, PluginHost, type Plugin, type Tool } from '../../../../src/main/core/plugin'

const tool = (description: string): Tool =>
  defineTool({ description, inputSchema: z.object({}), execute: () => undefined })

describe('PluginHost', () => {
  it('activates a plugin and collects its contributions', async () => {
    const registry = new Registry()
    const token = defineService()
    const testTool = tool('test tool')
    const skill = { path: 'test.md', description: 'test skill' }
    registry.register(token, { application: true })
    const plugin: Plugin = {
      manifest: { id: 'test', displayName: 'Test' },
      activate(context) {
        expect(context.manifest).toBe(this.manifest)
        expect(context.registry.get(token)).toEqual({ application: true })
        context.registerTool('run', testTool)
        context.registerSkill('review', skill)
      }
    }
    const host = new PluginHost(registry)

    await host.activate(plugin)

    expect(host.listPlugins()).toEqual([{ id: 'test', displayName: 'Test' }])
    expect(host.getTools('test')?.get('run')?.description).toBe('test tool')
    expect(host.getSkills('test')?.get('review')).toBe(skill)
  })

  it('disposes subscriptions in reverse order on deactivation', async () => {
    const calls: number[] = []
    const plugin: Plugin = {
      manifest: { id: 'test' },
      activate(context) {
        context.subscriptions.push(
          { dispose: () => calls.push(1) },
          { dispose: () => calls.push(2) }
        )
      }
    }
    const host = new PluginHost(new Registry())
    await host.activate(plugin)

    await host.deactivate('test')

    expect(calls).toEqual([2, 1])
    expect(host.has('test')).toBe(false)
  })

  it('rolls back subscriptions when activation fails', async () => {
    const dispose = vi.fn()
    const error = new Error('activation failed')
    const plugin: Plugin = {
      manifest: { id: 'broken' },
      activate(context) {
        context.subscriptions.push({ dispose })
        throw error
      }
    }
    const host = new PluginHost(new Registry())

    await expect(host.activate(plugin)).rejects.toBe(error)

    expect(dispose).toHaveBeenCalledOnce()
    expect(host.has('broken')).toBe(false)
  })

  it('prevents concurrent activation of the same plugin', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = new PluginHost(new Registry())
    const plugin: Plugin = {
      manifest: { id: 'test' },
      activate: () => pending
    }

    const activation = host.activate(plugin)
    await expect(host.activate(plugin)).rejects.toThrow('Plugin already active: test')
    release?.()
    await activation
  })

  it('does not remove a replacement when an old activation fails', async () => {
    let reject: ((error: Error) => void) | undefined
    const pending = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise
    })
    const host = new PluginHost(new Registry())
    const activation = host.activate({ manifest: { id: 'test' }, activate: () => pending })

    await host.deactivate('test')
    await host.activate({
      manifest: { id: 'test' },
      activate(context) {
        context.registerTool('run', tool('replacement'))
      }
    })
    reject?.(new Error('old activation failed'))

    await expect(activation).rejects.toThrow('old activation failed')
    expect(host.getTools('test')?.get('run')?.description).toBe('replacement')
  })

  it('reloads a plugin by deactivating the previous instance', async () => {
    const dispose = vi.fn()
    const host = new PluginHost(new Registry())
    await host.activate({
      manifest: { id: 'test' },
      activate(context) {
        context.registerTool('run', tool('old'))
        context.subscriptions.push({ dispose })
      }
    })

    await host.reload({
      manifest: { id: 'test' },
      activate(context) {
        context.registerTool('run', tool('new'))
      }
    })

    expect(dispose).toHaveBeenCalledOnce()
    expect(host.getTools('test')?.get('run')?.description).toBe('new')
  })

  it('leaves a plugin inactive when reload fails', async () => {
    const host = new PluginHost(new Registry())
    await host.activate({ manifest: { id: 'test' }, activate() {} })

    await expect(
      host.reload({
        manifest: { id: 'test' },
        activate() {
          throw new Error('reload failed')
        }
      })
    ).rejects.toThrow('reload failed')

    expect(host.has('test')).toBe(false)
  })

  it('uses the latest contribution registered under a name', async () => {
    const plugin: Plugin = {
      manifest: { id: 'duplicate' },
      activate(context) {
        context.registerTool('run', tool('first'))
        context.registerTool('run', tool('second'))
      }
    }

    const host = new PluginHost(new Registry())
    await host.activate(plugin)

    expect(host.getTools('duplicate')?.get('run')?.description).toBe('second')
  })

  it('returns contributions by plugin', async () => {
    const host = new PluginHost(new Registry())
    const createPlugin = (id: string): Plugin => ({
      manifest: { id },
      activate(context) {
        context.registerTool('z', tool('z'))
        context.registerTool('a', tool('a'))
        context.registerSkill('z', { path: 'z.md', description: 'z' })
        context.registerSkill('a', { path: 'a.md', description: 'a' })
      }
    })

    await host.activate(createPlugin('z'))
    await host.activate(createPlugin('a'))

    expect(host.listPlugins().map(({ id }) => id)).toEqual(['z', 'a'])
    expect([...host.getTools('a')!.keys()]).toEqual(['z', 'a'])
    expect([...host.getSkills('z')!.keys()]).toEqual(['z', 'a'])
  })

  it('returns readonly plugin contributions', async () => {
    const host = new PluginHost(new Registry())
    await host.activate({
      manifest: { id: 'test' },
      activate(context) {
        context.registerTool('lazy', tool('lazy'))
        context.registerTool(
          'eager',
          defineTool({
            description: 'eager',
            metadata: { eager: true },
            inputSchema: z.object({}),
            execute: () => undefined
          })
        )
        context.registerSkill('lazy', { path: 'lazy.md', description: 'lazy' })
        context.registerSkill('eager', {
          path: 'eager.md',
          description: 'eager',
          metadata: { eager: true }
        })
      }
    })

    const tools = host.getTools('test')
    const skills = host.getSkills('test')
    expect([...tools!.keys()]).toEqual(['lazy', 'eager'])
    expect([...skills!.keys()]).toEqual(['lazy', 'eager'])
    expect(host.getTools('missing')).toBeUndefined()
    expect(host.getSkills('missing')).toBeUndefined()
  })

  it('rejects plugins that register invalid tools', async () => {
    const host = new PluginHost(new Registry())

    await expect(
      host.activate({
        manifest: { id: 'invalid' },
        activate(context) {
          context.registerTool('tool', { description: 'invalid' })
        }
      })
    ).rejects.toThrow('Tool input schema must be a Zod object.')

    expect(host.has('invalid')).toBe(false)
  })

  it('continues disposing subscriptions after a failure', async () => {
    const dispose = vi.fn()
    const host = new PluginHost(new Registry())
    await host.activate({
      manifest: { id: 'test' },
      activate(context) {
        context.subscriptions.push(
          { dispose },
          {
            dispose() {
              throw new Error('dispose failed')
            }
          }
        )
      }
    })

    await host.deactivate('test')

    expect(dispose).toHaveBeenCalledOnce()
  })

  it('disposes plugins in reverse activation order', async () => {
    const calls: string[] = []
    const host = new PluginHost(new Registry())
    for (const id of ['first', 'second']) {
      await host.activate({
        manifest: { id },
        activate(context) {
          context.subscriptions.push({ dispose: () => calls.push(id) })
        }
      })
    }

    await host.dispose()

    expect(calls).toEqual(['second', 'first'])
    expect(host.listPlugins()).toEqual([])
  })
})
