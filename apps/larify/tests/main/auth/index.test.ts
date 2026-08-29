import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: { focus: vi.fn() },
  auth: {
    getState: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    restore: vi.fn(),
    subscribe: vi.fn()
  },
  handle: vi.fn(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler }
}))

vi.mock('../../../src/main/auth/service', () => ({
  AuthService: class {
    getState = mocks.auth.getState
    login = mocks.auth.login
    logout = mocks.auth.logout
    restore = mocks.auth.restore
    subscribe = mocks.auth.subscribe
  }
}))

import { registerAuth } from '../../../src/main/auth'

describe('authentication registration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers authentication IPC and restores the saved session', () => {
    mocks.auth.subscribe.mockReturnValue(vi.fn())
    const state = { status: 'unauthenticated' }
    const login = Promise.resolve({ status: 'authenticated' })
    const logout = Promise.resolve()
    mocks.auth.getState.mockReturnValue(state)
    mocks.auth.login.mockReturnValue(login)
    mocks.auth.logout.mockReturnValue(logout)
    const register = vi.fn()
    const application = {
      window: { get: vi.fn() },
      registry: { register }
    }

    registerAuth(application as never)

    expect(mocks.handle.mock.calls.map(([channel]) => channel)).toEqual([
      'auth:state',
      'auth:login',
      'auth:logout'
    ])
    expect(mocks.auth.restore).toHaveBeenCalledOnce()

    const handlers = Object.fromEntries(mocks.handle.mock.calls)
    expect(handlers['auth:state']()).toBe(state)
    expect(handlers['auth:login']()).toBe(login)
    expect(handlers['auth:logout']()).toBe(logout)
    expect(mocks.auth.getState).toHaveBeenCalledOnce()
    expect(mocks.auth.login).toHaveBeenCalledOnce()
    expect(mocks.auth.logout).toHaveBeenCalledOnce()
  })

  it('broadcasts state, focuses after login, and removes all wiring on disposal', () => {
    let notify!: (state: { status: string }) => void
    const unsubscribe = vi.fn()
    mocks.auth.subscribe.mockImplementation((listener) => {
      notify = listener
      return unsubscribe
    })
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      moveTop: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() }
    }
    const register = vi.fn()

    registerAuth({ window: { get: () => window }, registry: { register } } as never)
    notify({ status: 'authenticated' })

    expect(window.webContents.send).toHaveBeenCalledWith('auth:changed', {
      status: 'authenticated'
    })
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true)
    expect(window.moveTop).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(2, false)

    const disposable = register.mock.calls[0][1]
    disposable.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(mocks.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      'auth:state',
      'auth:login',
      'auth:logout'
    ])
  })

  it('does not focus for signed-out state or notify a destroyed window', () => {
    let notify!: (state: { status: string }) => void
    mocks.auth.subscribe.mockImplementation((listener) => {
      notify = listener
      return vi.fn()
    })
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      moveTop: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() }
    }

    registerAuth({ window: { get: () => window }, registry: { register: vi.fn() } } as never)
    notify({ status: 'unauthenticated' })

    expect(window.webContents.send).toHaveBeenCalledOnce()
    expect(window.show).not.toHaveBeenCalled()
    expect(window.focus).not.toHaveBeenCalled()

    window.isDestroyed.mockReturnValue(true)
    notify({ status: 'authenticated' })
    expect(window.webContents.send).toHaveBeenCalledOnce()
  })
})
