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

  it('registers and removes a value without a dispose method', async () => {
    const registry = new Registry()
    const token = defineService()
    const value = { name: 'plain value' }

    registry.register(token, value)
    await registry.dispose(token)

    expect(registry.get(token)).toBeUndefined()
  })

  it.each([undefined, null, false, 0, '', 1n, Symbol('value')])(
    'registers and removes the primitive value %s',
    async (value) => {
      const registry = new Registry()
      const token = defineService()

      registry.register(token, value)
      expect(() => registry.register(token, 'duplicate')).toThrow(
        'Service is already registered.'
      )

      await expect(registry.dispose(token)).resolves.toBeUndefined()
      expect(registry.get(token)).toBeUndefined()
    }
  )

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

  it('awaits asynchronous disposal', async () => {
    const registry = new Registry()
    const token = defineService()
    let resolve!: () => void
    const pending = new Promise<void>((done) => {
      resolve = done
    })
    const dispose = vi.fn(() => pending)
    registry.register(token, service(dispose))

    const disposing = registry.dispose(token)
    expect(dispose).toHaveBeenCalledOnce()
    expect(registry.get(token)).toBeUndefined()

    let completed = false
    void disposing.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    resolve()
    await disposing
    expect(completed).toBe(true)
  })

  it('supports a disposable function value', async () => {
    const registry = new Registry()
    const token = defineService()
    const value = Object.assign(() => undefined, { dispose: vi.fn() })
    registry.register(token, value)

    await registry.dispose(token)

    expect(value.dispose).toHaveBeenCalledOnce()
  })

  it('removes a service before propagating its disposal error', async () => {
    const registry = new Registry()
    const token = defineService()
    const error = new Error('cleanup failed')
    registry.register(
      token,
      service(() => {
        throw error
      })
    )

    await expect(registry.dispose(token)).rejects.toBe(error)
    expect(registry.get(token)).toBeUndefined()
    expect(() => registry.register(token, 'replacement')).not.toThrow()
  })

  it('treats a non-function dispose property as a plain value', async () => {
    const registry = new Registry()
    const token = defineService()
    registry.register(token, { dispose: 'not a function' })

    await expect(registry.dispose(token)).resolves.toBeUndefined()
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

  it('continues when reading a dispose property throws', async () => {
    const registry = new Registry()
    const order: string[] = []
    const remaining = defineService()
    const broken = defineService()
    registry.register(remaining, service(() => order.push('remaining')))
    registry.register(broken, {
      get dispose(): never {
        throw new Error('broken getter')
      }
    })

    await expect(registry.disposeAll()).resolves.toBeUndefined()

    expect(order).toEqual(['remaining'])
    expect(registry.get(remaining)).toBeUndefined()
    expect(registry.get(broken)).toBeUndefined()
  })

  it('is empty after repeated disposeAll calls and can be reused', async () => {
    const registry = new Registry()
    const first = defineService()
    const second = defineService()
    const dispose = vi.fn()
    registry.register(first, service(dispose))

    await registry.disposeAll()
    await registry.disposeAll()
    registry.register(second, 'new value')

    expect(dispose).toHaveBeenCalledOnce()
    expect(registry.get(second)).toBe('new value')
  })

  it('handles one service disposing another service', async () => {
    const registry = new Registry()
    const first = defineService()
    const second = defineService()
    const firstDispose = vi.fn()
    const secondDispose = vi.fn(async () => {
      await registry.dispose(first)
    })
    registry.register(first, service(firstDispose))
    registry.register(second, service(secondDispose))

    await registry.disposeAll()

    expect(secondDispose).toHaveBeenCalledOnce()
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(registry.get(first)).toBeUndefined()
    expect(registry.get(second)).toBeUndefined()
  })
})
