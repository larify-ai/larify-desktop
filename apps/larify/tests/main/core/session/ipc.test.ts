import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => {
      mocks.removeHandler(channel)
      mocks.handlers.delete(channel)
    }
  }
}))

vi.mock('../../../../src/main/core/agent/message-sanitizer', () => ({
  sanitizeAndValidateMessages: async (messages: unknown[]) => messages
}))

import { registerSessionHandlers } from '../../../../src/main/core/session/ipc'
import { createSessionQueries } from '../../../../src/main/core/session/queries'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.removeHandler.mockClear()
})

describe('session IPC', () => {
  it('registers and removes every handler', async () => {
    const sessions = {
      loadSession: vi.fn(),
      saveSession: vi.fn(),
      listSessions: vi.fn(),
      listCwds: vi.fn()
    }
    const disposable = registerSessionHandlers(sessions as never)

    expect([...mocks.handlers.keys()].sort()).toEqual([
      'session:cwds',
      'session:list',
      'session:msgs'
    ])

    await disposable.dispose()
    expect(mocks.handlers.size).toBe(0)
  })

  it('delegates reads to the session store', () => {
    const store = {
      listCwds: vi.fn(() => ['/cwd']),
      listSessions: vi.fn(() => [{ id: 'session' }]),
      loadSession: vi.fn(() => ({ messages: [{ id: 'message' }] }))
    }
    const queries = createSessionQueries(store as never)

    expect(queries['session:cwds']()).toEqual(['/cwd'])
    expect(queries['session:list']({}, '/cwd', 10, 20)).toEqual([{ id: 'session' }])
    expect(queries['session:msgs']({}, 'session', 30, 40)).toEqual([{ id: 'message' }])
    expect(store.listSessions).toHaveBeenCalledWith('/cwd', 10, 20)
    expect(store.loadSession).toHaveBeenCalledWith('session', 30, 40)
  })

})
