// @vitest-environment jsdom

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from '../../../../src/renderer/src/app/auth/auth-gate'
import { useAuth } from '../../../../src/renderer/src/app/auth/auth-context'

const reactEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

function AuthProbe(): ReactElement {
  const { email, logout } = useAuth()
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'email' }, email ?? 'none'),
    createElement('button', { type: 'button', onClick: () => void logout() }, '登出')
  )
}

function hasLoginButton(container: HTMLElement): boolean {
  return [...container.querySelectorAll('button')].some((button) => button.textContent === '登录')
}

describe('AuthGate', () => {
  let container: HTMLDivElement
  let root: Root
  let invoke: ReturnType<typeof vi.fn>
  let on: ReturnType<typeof vi.fn>
  let unsubscribe: ReturnType<typeof vi.fn>
  let stateListener: (value: unknown) => void

  beforeEach(() => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    invoke = vi.fn().mockResolvedValue({ status: 'unauthenticated' })
    unsubscribe = vi.fn()
    on = vi.fn((_channel: string, listener: (value: unknown) => void) => {
      stateListener = listener
      return unsubscribe
    })
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, on }
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('subscribes to auth:changed before requesting the initial state', async () => {
    await act(async () => root.render(createElement(AuthGate, null, createElement('div'))))
    expect(on).toHaveBeenCalledWith('auth:changed', expect.any(Function))
    expect(invoke).toHaveBeenCalledWith('auth:state')
    expect(on.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0])
  })

  it('shows the restoring placeholder while the state is restoring', async () => {
    invoke.mockResolvedValueOnce({ status: 'restoring' })
    await act(async () => root.render(createElement(AuthGate, null, createElement('div'))))
    expect(container.querySelector('[aria-label="正在恢复登录"]')).not.toBeNull()
  })

  it('renders the login view when unauthenticated', async () => {
    invoke.mockResolvedValueOnce({ status: 'unauthenticated' })
    await act(async () => root.render(createElement(AuthGate, null, createElement('div'))))
    expect(hasLoginButton(container)).toBe(true)
  })

  it('renders children and exposes the email when authenticated', async () => {
    invoke.mockResolvedValueOnce({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.c' }
    })
    await act(async () => root.render(createElement(AuthGate, null, createElement(AuthProbe))))
    expect(container.querySelector('[data-testid="email"]')?.textContent).toBe('a@b.c')
  })

  it('switches to children when auth:changed broadcasts authenticated', async () => {
    invoke.mockResolvedValueOnce({ status: 'restoring' })
    await act(async () => root.render(createElement(AuthGate, null, createElement(AuthProbe))))
    expect(container.querySelector('[data-testid="email"]')).toBeNull()

    await act(async () => {
      stateListener({ status: 'authenticated', user: { id: '1', email: 'a@b.c' } })
    })

    expect(container.querySelector('[data-testid="email"]')?.textContent).toBe('a@b.c')
  })

  it('does not let the initial request overwrite a fresher broadcast', async () => {
    let resolveInitial!: (value: unknown) => void
    invoke.mockImplementation((channel: string) =>
      channel === 'auth:state'
        ? new Promise((resolve) => {
            resolveInitial = resolve
          })
        : Promise.resolve(undefined)
    )
    await act(async () => root.render(createElement(AuthGate, null, createElement(AuthProbe))))

    await act(async () => {
      stateListener({ status: 'authenticated', user: { id: '1', email: 'fresh@b.c' } })
      resolveInitial({ status: 'unauthenticated' })
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="email"]')?.textContent).toBe('fresh@b.c')
  })

  it('recovers through auth:changed when the initial request fails', async () => {
    invoke.mockRejectedValueOnce(new Error('IPC unavailable'))
    await act(async () => root.render(createElement(AuthGate, null, createElement('div'))))
    expect(container.querySelector('[aria-label="正在恢复登录"]')).not.toBeNull()

    await act(async () => {
      stateListener({ status: 'unauthenticated' })
    })

    expect(hasLoginButton(container)).toBe(true)
  })

  it('calls auth:logout through useAuth', async () => {
    await act(async () => root.render(createElement(AuthGate, null, createElement(AuthProbe))))
    await act(async () => {
      stateListener({ status: 'authenticated', user: { id: '1', email: 'a@b.c' } })
    })
    const logoutButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '登出'
    ) as HTMLButtonElement

    await act(async () => logoutButton.click())

    expect(invoke).toHaveBeenCalledWith('auth:logout')
  })

  it('throws when useAuth is used outside AuthGate', () => {
    expect(() => {
      act(() => root.render(createElement(AuthProbe)))
    }).toThrow('useAuth must be used inside AuthGate')
  })

  it('unsubscribes from auth:changed on unmount', async () => {
    await act(async () => root.render(createElement(AuthGate, null, createElement('div'))))
    expect(on).toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()

    await act(async () => root.unmount())

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('fetches New API credentials after sign-in so the model runtime is ready', async () => {
    invoke.mockResolvedValueOnce({ status: 'restoring' })
    await act(async () => root.render(createElement(AuthGate, null, createElement('div'))))
    expect(invoke).not.toHaveBeenCalledWith('model-api:get-credentials')

    await act(async () => {
      stateListener({ status: 'authenticated', user: { id: '1', email: 'a@b.c' } })
    })

    expect(invoke).toHaveBeenCalledWith('model-api:get-credentials')
  })

  it('does not fetch credentials while unauthenticated', async () => {
    invoke.mockResolvedValueOnce({ status: 'unauthenticated' })
    await act(async () => root.render(createElement(AuthGate, null, createElement('div'))))
    expect(invoke).not.toHaveBeenCalledWith('model-api:get-credentials')
  })
})
