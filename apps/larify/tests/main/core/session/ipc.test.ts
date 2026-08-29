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

import { registerSessionHandlers } from '../../../../src/main/core/session/ipc'
import { createSessionQueries } from '../../../../src/main/core/session/queries'
import { larifyPath } from '../../../../src/main/utils/app-paths'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.removeHandler.mockClear()
})

describe('session IPC', () => {
  it('registers and removes every handler', async () => {
    const sessions = {
      loadVisibleMessages: vi.fn(),
      loadNavigationIndex: vi.fn(),
      countMessages: vi.fn(),
      saveSession: vi.fn(),
      listSessions: vi.fn(),
      listCwds: vi.fn()
    }
    const disposable = registerSessionHandlers(sessions as never)

    expect([...mocks.handlers.keys()].sort()).toEqual([
      'session:cwds',
      'session:list',
      'session:msg-count',
      'session:msgs',
      'session:navigation',
      'session:rename'
    ])

    await disposable.dispose()
    expect(mocks.handlers.size).toBe(0)
  })

  it('delegates reads to the session store', () => {
    const store = {
      listCwds: vi.fn(() => ['/cwd']),
      listSessions: vi.fn(() => [{ id: 'session' }]),
      loadVisibleMessages: vi.fn(() => [{ id: 'message' }]),
      loadNavigationIndex: vi.fn(() => [{ id: 'navigation' }]),
      countMessages: vi.fn(() => 42),
      renameSession: vi.fn()
    }
    const queries = createSessionQueries(store as never)

    expect(queries['session:cwds']()).toEqual(['/cwd'])
    expect(queries['session:list']({}, '/cwd', 10, 20)).toEqual([{ id: 'session' }])
    expect(queries['session:msgs']({}, 'session', 30, 40)).toEqual([{ id: 'message' }])
    expect(queries['session:msg-count']({}, 'session')).toBe(42)
    expect(queries['session:navigation']({}, 'session')).toEqual([{ id: 'navigation' }])
    queries['session:rename']({}, 'session', 'New title')
    expect(store.listSessions).toHaveBeenCalledWith('/cwd', 10, 20)
    expect(store.loadVisibleMessages).toHaveBeenCalledWith('session', 30, 40)
    expect(store.countMessages).toHaveBeenCalledWith('session')
    expect(store.loadNavigationIndex).toHaveBeenCalledWith('session')
    expect(store.renameSession).toHaveBeenCalledWith('session', 'New title')
  })

  it('represents the default workspace with an empty cwd', () => {
    const defaultCwd = larifyPath('workspace')
    const store = {
      listCwds: vi.fn(() => [defaultCwd, '/cwd', defaultCwd]),
      listSessions: vi.fn(() => [{ id: 'session', cwd: defaultCwd }]),
      loadVisibleMessages: vi.fn(),
      countMessages: vi.fn()
    }
    const queries = createSessionQueries(store as never)

    expect(queries['session:cwds']()).toEqual(['', '/cwd'])
    expect(queries['session:list']({}, '')).toEqual([{ id: 'session', cwd: '' }])
    expect(store.listSessions).toHaveBeenCalledWith(defaultCwd, undefined, undefined)
  })
})
