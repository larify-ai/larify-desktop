import { describe, expect, it, vi } from 'vitest'
import {
  ResourceManager,
  SESSION_RESOURCE_IDLE_TIMEOUT_MS
} from '../../../../src/main/core/resource/manager'

const testManager = (): ResourceManager => {
  const manager = new ResourceManager()
  const open = (
    _id: number,
    _sessionId: string,
    options: unknown
  ): { dispose(): void | Promise<void> } => (options as () => { dispose(): void | Promise<void> })()
  manager.register('terminal', open)
  manager.register('browser', open)
  return manager
}

describe('ResourceManager', () => {
  it('creates resources through a registered type factory', () => {
    const manager = new ResourceManager()
    const dispose = vi.fn()
    const factory = vi.fn(() => ({ dispose }))
    manager.register('terminal', factory)

    expect(manager.create('terminal', 'session-a', { cwd: '/tmp' })).toBe(1)
    expect(factory).toHaveBeenCalledWith(1, 'session-a', { cwd: '/tmp' })
  })

  it('rejects duplicate and unknown resource types without consuming an id', () => {
    const manager = new ResourceManager()
    const factory = vi.fn(() => ({ dispose: vi.fn() }))
    manager.register('terminal', factory)

    expect(() => manager.register('terminal', factory)).toThrow('already registered')
    expect(() => manager.create('browser', 'session-a')).toThrow('not registered')
    expect(manager.create('terminal', 'session-a')).toBe(1)
  })

  it('does not let an old registration dispose a replacement', () => {
    const manager = new ResourceManager()
    const first = manager.register('terminal', () => ({ dispose: vi.fn() }))
    first.dispose()
    manager.register('terminal', () => ({ dispose: vi.fn() }))

    first.dispose()
    expect(manager.create('terminal', 'session-a')).toBe(1)
  })

  it('assigns one global id space across resource types and sessions', () => {
    const manager = testManager()

    const terminal = manager.create('terminal', 'session-a', () => ({ dispose: vi.fn() }))
    const browser = manager.create('browser', 'session-b', () => ({ dispose: vi.fn() }))

    expect([terminal, browser]).toEqual([1, 2])
    expect(manager.list()).toEqual([
      { id: 1, type: 'terminal', sessionId: 'session-a' },
      { id: 2, type: 'browser', sessionId: 'session-b' }
    ])
  })

  it('does not expose lifecycle methods', () => {
    const manager = testManager()
    manager.create('terminal', 'session-a', () => ({ dispose: vi.fn() }))
    manager.create('browser', 'session-a', () => ({ dispose: vi.fn() }))
    manager.create('terminal', 'session-b', () => ({ dispose: vi.fn() }))

    expect(manager.list()[0]).toEqual({ id: 1, type: 'terminal', sessionId: 'session-a' })
    expect(manager.list()[0]).not.toHaveProperty('dispose')
  })

  it('gets one resource and filters resource lists', () => {
    const manager = testManager()
    manager.create('terminal', 'session-a', () => ({ dispose: vi.fn() }))
    manager.create('browser', 'session-a', () => ({ dispose: vi.fn() }))
    manager.create('terminal', 'session-b', () => ({ dispose: vi.fn() }))

    expect(manager.get(1)).toEqual({ id: 1, type: 'terminal', sessionId: 'session-a' })
    expect(manager.get(99)).toBeUndefined()
    expect(manager.list({ type: 'terminal' }).map(({ id }) => id)).toEqual([1, 3])
    expect(manager.list({ sessionId: 'session-a' }).map(({ id }) => id)).toEqual([1, 2])
    expect(manager.list({ type: 'terminal', sessionId: 'session-a' })).toEqual([
      { id: 1, type: 'terminal', sessionId: 'session-a' }
    ])
  })

  it('removes a resource before closing it and emits each state', async () => {
    const manager = testManager()
    const states: number[][] = []
    manager.bindChange((resources) => states.push(resources.map(({ id }) => id)))
    const dispose = vi.fn(() => {
      expect(manager.list()).toEqual([])
    })

    const id = manager.create('terminal', 'session-a', () => ({ dispose }))
    await manager.close(id)

    expect(dispose).toHaveBeenCalledOnce()
    expect(states).toEqual([[1], []])
  })

  it('closes multiple resources with one state change', async () => {
    const manager = testManager()
    const states: number[][] = []
    const first = vi.fn()
    const second = vi.fn()
    manager.bindChange((resources) => states.push(resources.map(({ id }) => id)))
    manager.create('terminal', 'session-a', () => ({ dispose: first }))
    manager.create('browser', 'session-a', () => ({ dispose: second }))
    states.length = 0

    await manager.closeMany([1, 2, 2, 99])

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(states).toEqual([[]])
  })

  it('disposes a large resource batch with one state change', async () => {
    const manager = testManager()
    const dispose = vi.fn()
    for (let index = 0; index < 500; index += 1) {
      manager.create('terminal', 'session-a', () => ({ dispose }))
    }
    const listener = vi.fn()
    manager.bindChange(listener)

    await manager.destroy('session-a')

    expect(dispose).toHaveBeenCalledTimes(500)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith([])
  })

  it('starts every disposal and removes the batch when one disposal fails', async () => {
    const manager = testManager()
    const first = vi.fn(() => Promise.reject(new Error('close failed')))
    const second = vi.fn()
    manager.create('terminal', 'session-a', () => ({ dispose: first }))
    manager.create('browser', 'session-a', () => ({ dispose: second }))

    await expect(manager.closeMany([1, 2])).rejects.toThrow('close failed')

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(manager.list()).toEqual([])
  })

  it('starts every disposal when one disposal throws synchronously', async () => {
    const manager = testManager()
    const second = vi.fn()
    manager.create('terminal', 'session-a', () => ({
      dispose: () => {
        throw new Error('close failed')
      }
    }))
    manager.create('browser', 'session-a', () => ({ dispose: second }))

    await expect(manager.closeMany([1, 2])).rejects.toThrow('close failed')

    expect(second).toHaveBeenCalledOnce()
    expect(manager.list()).toEqual([])
  })

  it('isolates listener failures from resource lifecycle and other listeners', async () => {
    const manager = testManager()
    const states: number[][] = []
    const dispose = vi.fn()
    manager.bindChange(() => {
      throw new Error('listener failed')
    })
    manager.bindChange((resources) => states.push(resources.map(({ id }) => id)))

    const id = manager.create('terminal', 'session-a', () => ({ dispose }))
    await manager.close(id)

    expect(dispose).toHaveBeenCalledOnce()
    expect(states).toEqual([[1], []])
  })

  it('disposes all resources', async () => {
    const manager = testManager()
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()
    manager.create('terminal', 'session-a', () => ({ dispose: first }))
    manager.create('browser', 'session-a', () => ({ dispose: second }))
    manager.create('terminal', 'session-b', () => ({ dispose: third }))

    await manager.dispose()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(third).toHaveBeenCalledOnce()
    expect(manager.list()).toEqual([])
  })

  it('closes only resources owned by one session', async () => {
    const manager = testManager()
    const first = vi.fn()
    const second = vi.fn()
    const other = vi.fn()
    manager.create('terminal', 'session-a', () => ({ dispose: first }))
    manager.create('browser', 'session-a', () => ({ dispose: second }))
    manager.create('terminal', 'session-b', () => ({ dispose: other }))

    await manager.destroy('session-a')

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(other).not.toHaveBeenCalled()
    expect(manager.list()).toEqual([{ id: 3, type: 'terminal', sessionId: 'session-b' }])
  })

  it('emits one resource change while destroying a session', async () => {
    const manager = testManager()
    const states: number[][] = []
    manager.create('terminal', 'session-a', () => ({ dispose: vi.fn() }))
    manager.create('browser', 'session-a', () => ({ dispose: vi.fn() }))
    manager.create('terminal', 'session-b', () => ({ dispose: vi.fn() }))
    manager.bindChange((resources) => states.push(resources.map(({ id }) => id)))

    await manager.destroy('session-a')

    expect(states).toEqual([[3]])
  })

  it('runs session cleanup after closing its resources', async () => {
    const manager = testManager()
    manager.create('browser', 'session-a', () => ({ dispose: vi.fn() }))
    const cleanup = vi.fn(() => expect(manager.list({ sessionId: 'session-a' })).toEqual([]))
    manager.registerSessionCleanup(cleanup)

    await manager.destroy('session-a')

    expect(cleanup).toHaveBeenCalledWith('session-a')
  })

  it('does not create resources while their session is being destroyed', async () => {
    const manager = testManager()
    let finish!: () => void
    manager.registerSessionCleanup(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )

    const destroying = manager.destroy('session-a')
    expect(() => manager.create('browser', 'session-a', () => ({ dispose: vi.fn() }))).toThrow(
      'being destroyed'
    )
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish()
    await destroying
    expect(manager.create('browser', 'session-a', () => ({ dispose: vi.fn() }))).toBe(1)
  })

  it('shares one destruction task between concurrent callers', async () => {
    const manager = testManager()
    let finish!: () => void
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    manager.registerSessionCleanup(cleanup)

    const first = manager.destroy('session-a')
    const second = manager.destroy('session-a')

    expect(second).toBe(first)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish()
    await Promise.all([first, second])
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('continues closing a session when one resource fails', async () => {
    const manager = testManager()
    const second = vi.fn()
    manager.create('terminal', 'session-a', () => ({
      dispose: () => Promise.reject(new Error('close failed'))
    }))
    manager.create('browser', 'session-a', () => ({ dispose: second }))

    await expect(manager.destroy('session-a')).resolves.toBeUndefined()

    expect(second).toHaveBeenCalledOnce()
    expect(manager.list()).toEqual([])
  })

  it('destroys resources after their session has been inactive for the configured timeout', async () => {
    vi.useFakeTimers()
    const manager = new ResourceManager(1000)
    const dispose = vi.fn()
    manager.register('terminal', () => ({ dispose }))
    manager.setActiveSession('session-a')
    manager.create('terminal', 'session-a')

    manager.setActiveSession('session-b')
    await vi.advanceTimersByTimeAsync(999)
    expect(dispose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(dispose).toHaveBeenCalledOnce()
    expect(manager.list()).toEqual([])
    vi.useRealTimers()
  })

  it('cleans up an inactive session even after its last resource was already closed', async () => {
    vi.useFakeTimers()
    const manager = new ResourceManager(1000)
    const cleanup = vi.fn()
    manager.registerSessionCleanup(cleanup)
    manager.setActiveSession('session-a')

    manager.setActiveSession('session-b')
    await vi.advanceTimersByTimeAsync(1000)

    expect(cleanup).toHaveBeenCalledWith('session-a')
    vi.useRealTimers()
  })

  it('resets idle cleanup when a session becomes active again', async () => {
    vi.useFakeTimers()
    const manager = new ResourceManager(1000)
    const dispose = vi.fn()
    manager.register('terminal', () => ({ dispose }))
    manager.setActiveSession('session-a')
    manager.create('terminal', 'session-a')

    manager.setActiveSession('session-b')
    await vi.advanceTimersByTimeAsync(900)
    manager.setActiveSession('session-a')
    await vi.advanceTimersByTimeAsync(200)

    expect(dispose).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('uses exactly seven days as the production idle timeout', async () => {
    vi.useFakeTimers()
    const manager = new ResourceManager()
    const dispose = vi.fn()
    manager.register('terminal', () => ({ dispose }))
    manager.setActiveSession('session-a')
    manager.create('terminal', 'session-a')
    manager.setActiveSession('session-b')

    await vi.advanceTimersByTimeAsync(SESSION_RESOURCE_IDLE_TIMEOUT_MS - 1)
    expect(dispose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(dispose).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('never destroys the currently active session', async () => {
    vi.useFakeTimers()
    const manager = new ResourceManager(1000)
    const dispose = vi.fn()
    manager.register('terminal', () => ({ dispose }))
    manager.setActiveSession('session-a')
    manager.create('terminal', 'session-a')

    await vi.advanceTimersByTimeAsync(10_000)

    expect(dispose).not.toHaveBeenCalled()
    expect(manager.list()).toHaveLength(1)
    vi.useRealTimers()
  })

  it('starts a fresh full timeout after repeated session use', async () => {
    vi.useFakeTimers()
    const manager = new ResourceManager(1000)
    const dispose = vi.fn()
    manager.register('terminal', () => ({ dispose }))
    manager.setActiveSession('session-a')
    manager.create('terminal', 'session-a')

    manager.setActiveSession('session-b')
    await vi.advanceTimersByTimeAsync(900)
    manager.setActiveSession('session-a')
    manager.setActiveSession('session-b')
    await vi.advanceTimersByTimeAsync(999)
    expect(dispose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(dispose).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('restarts the idle timeout when an inactive session opens another resource', async () => {
    vi.useFakeTimers()
    const manager = new ResourceManager(1000)
    const dispose = vi.fn()
    manager.register('terminal', () => ({ dispose }))
    manager.setActiveSession('session-a')
    manager.create('terminal', 'session-b')

    await vi.advanceTimersByTimeAsync(900)
    manager.create('terminal', 'session-b')
    await vi.advanceTimersByTimeAsync(999)
    expect(dispose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(dispose).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('cancels pending idle cleanup when the manager is disposed', async () => {
    vi.useFakeTimers()
    const manager = new ResourceManager(1000)
    const cleanup = vi.fn()
    manager.register('terminal', () => ({ dispose: vi.fn() }))
    manager.registerSessionCleanup(cleanup)
    manager.setActiveSession('session-a')
    manager.create('terminal', 'session-a')
    manager.setActiveSession('session-b')

    await manager.dispose()
    await vi.advanceTimersByTimeAsync(1000)

    expect(cleanup).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not retain a resource when opening fails', () => {
    const manager = testManager()

    expect(() =>
      manager.create('terminal', 'session-a', () => {
        throw new Error('open failed')
      })
    ).toThrow('open failed')
    expect(manager.list()).toEqual([])
  })
})
