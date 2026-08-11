import { describe, expect, it, vi } from 'vitest'
import { ResourceManager } from '../../../../src/main/core/resource/manager'

const testManager = (): ResourceManager => {
  const manager = new ResourceManager()
  const open = (_id: number, _sessionId: string, options: unknown): { dispose(): void | Promise<void> } =>
    (options as () => { dispose(): void | Promise<void> })()
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
      () => new Promise<void>((resolve) => { finish = resolve })
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
