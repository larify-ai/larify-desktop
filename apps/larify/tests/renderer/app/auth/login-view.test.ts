// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginView } from '../../../../src/renderer/src/app/auth/login-view'

const reactEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

function findLoginButton(container: HTMLElement): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '登录'
  ) as HTMLButtonElement
}

describe('LoginView', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (initialError?: string): Promise<void> => {
    await act(async () => root.render(createElement(LoginView, { initialError })))
  }

  beforeEach(async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    window.bridge = {
      invoke: vi.fn().mockResolvedValue({ status: 'authenticated' })
    } as unknown as typeof window.bridge
    await render()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders the initial error passed through the prop', async () => {
    // The initial error is only applied on mount, so remount with the prop set.
    act(() => root.unmount())
    root = createRoot(container)
    await render('登录已超时，请重试。')
    expect(container.textContent).toContain('登录已超时，请重试。')
  })

  it('starts native OAuth and disables duplicate login attempts', async () => {
    let resolveLogin: ((state: { status: string }) => void) | undefined
    vi.mocked(window.bridge.invoke).mockImplementationOnce(
      () => new Promise((resolve) => (resolveLogin = resolve))
    )
    const loginButton = findLoginButton(container)

    act(() => loginButton.click())

    expect(window.bridge.invoke).toHaveBeenCalledWith('auth:login')
    expect(loginButton.disabled).toBe(true)

    await act(async () => resolveLogin?.({ status: 'authenticated' }))
  })

  it('keeps a draggable titlebar region on the signed-out screen', () => {
    expect(container.querySelector('.\\[-webkit-app-region\\:drag\\]')).not.toBeNull()
  })

  it('returns to the login action when native OAuth fails', async () => {
    vi.mocked(window.bridge.invoke).mockResolvedValueOnce({
      status: 'unauthenticated',
      error: '登录已取消。'
    })

    const loginButton = findLoginButton(container)
    await act(async () => loginButton.click())

    expect(container.textContent).toContain('登录已取消。')
    expect(loginButton.disabled).toBe(false)
  })

  it('shows a fallback error message when login returns no error', async () => {
    vi.mocked(window.bridge.invoke).mockResolvedValueOnce({ status: 'unauthenticated' })

    await act(async () => findLoginButton(container).click())

    expect(container.textContent).toContain('登录失败，请重试。')
  })

  it('shows a general error message when the login IPC rejects', async () => {
    vi.mocked(window.bridge.invoke).mockRejectedValueOnce(new Error('ipc failed'))

    await act(async () => findLoginButton(container).click())

    expect(container.textContent).toContain('登录失败，请重试。')
  })

  it('clears any previous error and re-enables the button when login succeeds', async () => {
    // The initial error is only applied on mount, so remount with the prop set.
    act(() => root.unmount())
    root = createRoot(container)
    await render('旧的错误提示')
    expect(container.textContent).toContain('旧的错误提示')

    await act(async () => findLoginButton(container).click())

    expect(container.textContent).not.toContain('旧的错误提示')
    expect(findLoginButton(container).disabled).toBe(false)
  })

  it('falls back to a generic error for an unexpected login state', async () => {
    vi.mocked(window.bridge.invoke).mockResolvedValueOnce({ status: 'restoring' })

    await act(async () => findLoginButton(container).click())

    expect(container.textContent).toContain('登录失败，请重试。')
  })

  it('is not disabled before any login attempt', () => {
    expect(findLoginButton(container).disabled).toBe(false)
  })
})
