// @vitest-environment jsdom

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthContext,
  type AuthContextValue,
  useAuth
} from '../../../../src/renderer/src/app/auth/auth-context'

const reactEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

function useAuthHarness(): ReactElement {
  const { email, logout } = useAuth()
  return createElement(
    'div',
    { 'data-testid': 'probe' },
    createElement('span', { 'data-testid': 'email' }, email ?? 'null'),
    createElement('button', { type: 'button', onClick: () => void logout() }, '登出')
  )
}

describe('auth-context', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderInProvider = async (value: AuthContextValue): Promise<void> => {
    await act(async () =>
      root.render(createElement(AuthContext.Provider, { value }, createElement(useAuthHarness)))
    )
  }

  const renderBare = async (): Promise<void> => {
    await act(async () => root.render(createElement(useAuthHarness)))
  }

  const renderNullProvider = async (): Promise<void> => {
    await act(async () =>
      root.render(
        createElement(AuthContext.Provider, { value: null }, createElement(useAuthHarness))
      )
    )
  }

  it('exposes the context value from a non-null provider', async () => {
    await renderInProvider({ email: 'a@b.c', logout: vi.fn() })

    expect(container.querySelector('[data-testid="email"]')?.textContent).toBe('a@b.c')
  })

  it('exposes the logout function from the provider and calls it', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    await renderInProvider({ email: null, logout })

    await act(async () => (container.querySelector('button') as HTMLButtonElement).click())

    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('renders a null email placeholder when the provider email is null', async () => {
    await renderInProvider({ email: null, logout: vi.fn() })

    expect(container.querySelector('[data-testid="email"]')?.textContent).toBe('null')
  })

  it('throws when used outside a provider (default null context)', async () => {
    await expect(renderBare()).rejects.toThrow('useAuth must be used inside AuthGate')
  })

  it('throws when an explicit provider value is null', async () => {
    await expect(renderNullProvider()).rejects.toThrow('useAuth must be used inside AuthGate')
  })
})
