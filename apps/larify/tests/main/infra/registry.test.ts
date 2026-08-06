import { describe, expect, it, vi } from 'vitest'
import { defineService, Registry } from '../../../src/main/infra/registry'

function service(dispose: () => void | Promise<void>): { dispose: () => void | Promise<void> } {
  return { dispose }
}

describe('Registry', () => {
  it('registers and gets a service by token', () => {
    const registry = new Registry()
    const token = defineService()
    const value = service(() => undefined)

    registry.register(token, value)

    expect(registry.get(token)).toBe(value)
  })

  it('rejects duplicate registration for the same token', () => {
    const registry = new Registry()
    const token = defineService()
    registry.register(
      token,
      service(() => undefined)
    )

    expect(() =>
      registry.register(
        token,
        service(() => undefined)
      )
    ).toThrow('Service is already registered.')
  })

  it('disposes and removes one service', async () => {
    const registry = new Registry()
    const token = defineService()
    const dispose = vi.fn()
    registry.register(token, service(dispose))

    await registry.dispose(token)
    await registry.dispose(token)

    expect(dispose).toHaveBeenCalledOnce()
    expect(registry.get(token)).toBeUndefined()
  })

  it('disposes services in reverse registration order', async () => {
    const registry = new Registry()
    const order: number[] = []
    const first = defineService()
    const second = defineService()
    registry.register(
      first,
      service(() => order.push(1))
    )
    registry.register(
      second,
      service(() => order.push(2))
    )

    await registry.disposeAll()

    expect(order).toEqual([2, 1])
    expect(registry.get(first)).toBeUndefined()
    expect(registry.get(second)).toBeUndefined()
  })

  it('continues disposing when one service fails', async () => {
    const registry = new Registry()
    const order: string[] = []
    const failed = defineService()
    const remaining = defineService()
    registry.register(
      failed,
      service(() => {
        order.push('failed')
        throw new Error('cleanup failed')
      })
    )
    registry.register(
      remaining,
      service(() => order.push('remaining'))
    )

    await expect(registry.disposeAll()).resolves.toBeUndefined()
    expect(order).toEqual(['remaining', 'failed'])
    expect(registry.get(failed)).toBeUndefined()
    expect(registry.get(remaining)).toBeUndefined()
  })
})
