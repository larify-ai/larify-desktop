import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stores: [] as Array<{ path: string; dispose: () => void }>,
  handlers: { dispose: vi.fn() },
  registerHandlers: vi.fn()
}))

vi.mock('../../../../src/main/utils/app-paths', () => ({
  sessionDatabasePath: () => 'sessions.db',
  backgroundSessionDatabasePath: () => 'background-sessions.db'
}))

vi.mock('../../../../src/main/core/session/store', () => ({
  SessionStore: class {
    path: string
    dispose = vi.fn()

    constructor(path: string) {
      this.path = path
      mocks.stores.push(this)
    }
  }
}))

vi.mock('../../../../src/main/core/session/ipc', () => ({
  registerSessionHandlers: mocks.registerHandlers
}))

import { registerSession } from '../../../../src/main/core/session/open'

beforeEach(() => {
  mocks.stores.length = 0
  mocks.registerHandlers.mockReset().mockReturnValue(mocks.handlers)
})

describe('registerSession', () => {
  it('registers isolated foreground and background stores', () => {
    const register = vi.fn()

    registerSession({ registry: { register } } as never)

    expect(mocks.stores.map(({ path }) => path)).toEqual(['sessions.db', 'background-sessions.db'])
    expect(mocks.registerHandlers).toHaveBeenCalledWith(mocks.stores[0])
    expect(register.mock.calls.map(([, resource]) => resource)).toEqual([
      mocks.stores[0],
      mocks.stores[1],
      mocks.handlers
    ])
  })
})
