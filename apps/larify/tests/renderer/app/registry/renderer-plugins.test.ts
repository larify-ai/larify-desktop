import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import {
  type RendererPlugin,
  RendererPluginHost
} from '../../../../src/renderer/src/app/registry/renderer-plugins'

describe('RendererPluginHost', () => {
  it('activates a plugin with the shared registry', () => {
    const registry = new Registry()
    const activate = vi.fn()
    new RendererPluginHost(registry).activate({ id: 'terminal', activate })

    expect(activate).toHaveBeenCalledWith({ registry, subscriptions: [] })
  })

  it('rejects duplicate active plugin ids', () => {
    const host = new RendererPluginHost(new Registry())
    const plugin: RendererPlugin = { id: 'terminal', activate: vi.fn() }
    host.activate(plugin)

    expect(() => host.activate(plugin)).toThrow('Renderer plugin already active: terminal')
  })

  it('disposes subscriptions in reverse order and continues after failures', async () => {
    const order: number[] = []
    const host = new RendererPluginHost(new Registry())
    host.activate({
      id: 'terminal',
      activate: ({ subscriptions }) => {
        subscriptions.push({ dispose: () => order.push(1) })
        subscriptions.push({
          dispose: () => {
            order.push(2)
            throw new Error('cleanup failed')
          }
        })
      }
    })

    await host.deactivate('terminal')

    expect(order).toEqual([2, 1])
    await expect(host.deactivate('terminal')).resolves.toBeUndefined()
  })

  it('rolls back subscriptions when activation fails', () => {
    const dispose = vi.fn()
    const host = new RendererPluginHost(new Registry())
    const plugin: RendererPlugin = {
      id: 'terminal',
      activate: ({ subscriptions }) => {
        subscriptions.push({ dispose })
        throw new Error('activation failed')
      }
    }

    expect(() => host.activate(plugin)).toThrow('activation failed')
    expect(dispose).toHaveBeenCalledOnce()
    expect(() => host.activate({ id: 'terminal', activate: vi.fn() })).not.toThrow()
  })

  it('starts every rollback immediately when one disposal is asynchronous', () => {
    const synchronousDispose = vi.fn()
    const host = new RendererPluginHost(new Registry())
    let finishAsyncDispose!: () => void
    const pending = new Promise<void>((resolve) => {
      finishAsyncDispose = resolve
    })

    expect(() =>
      host.activate({
        id: 'terminal',
        activate: ({ subscriptions }) => {
          subscriptions.push({ dispose: synchronousDispose })
          subscriptions.push({ dispose: () => pending })
          throw new Error('activation failed')
        }
      })
    ).toThrow('activation failed')

    expect(synchronousDispose).toHaveBeenCalledOnce()
    finishAsyncDispose()
  })

  it('disposes plugins in reverse activation order', async () => {
    const order: string[] = []
    const host = new RendererPluginHost(new Registry())
    host.activate({
      id: 'terminal',
      activate: ({ subscriptions }) => {
        subscriptions.push({ dispose: () => order.push('terminal') })
      }
    })
    host.activate({
      id: 'browser',
      activate: ({ subscriptions }) => {
        subscriptions.push({ dispose: () => order.push('browser') })
      }
    })

    await host.dispose()

    expect(order).toEqual(['browser', 'terminal'])
  })
})
