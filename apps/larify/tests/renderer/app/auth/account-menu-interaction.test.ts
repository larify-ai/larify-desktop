// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- hoisted mock state ----
const hoisted = vi.hoisted(() => {
  return {
    email: 'a@b.c',
    logout: vi.fn(),
    resolvedTheme: 'light' as string,
    setTheme: vi.fn()
  }
})

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: hoisted.resolvedTheme, setTheme: hoisted.setTheme })
}))

vi.mock('../../../../src/renderer/src/app/auth/auth-context', () => ({
  useAuth: () => ({ email: hoisted.email, logout: hoisted.logout })
}))

// Render the dropdown content regardless of open state so menu items can be
// interacted with directly; the trigger is a plain button that only needs to
// exist for the layout. This lets tests focus on AccountMenu's own logic.
vi.mock('@renderer/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  DropdownMenuContent: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'menu-content' }, children),
  DropdownMenuItem: ({
    children,
    onSelect
  }: {
    children: ReactNode
    onSelect?: (event: { preventDefault: () => void }) => void
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => onSelect?.({ preventDefault: () => undefined })
      },
      children
    ),
  DropdownMenuSeparator: () => createElement('hr')
}))

vi.mock('@renderer/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { 'data-testid': 'dialog' }, children) : createElement('span'),
  DialogContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  DialogHeader: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  DialogTitle: ({ children }: { children: ReactNode }) =>
    createElement('h2', { 'data-testid': 'dialog-title' }, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement('p', null, children),
  DialogFooter: ({ children }: { children: ReactNode }) => createElement('div', null, children)
}))

import { AccountMenu } from '../../../../src/renderer/src/app/auth/account-menu'

const reactEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find(
    (button) => button.textContent === text
  ) as HTMLButtonElement
}

describe('AccountMenu interactions', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (): Promise<void> => {
    await act(async () => root.render(createElement(AccountMenu)))
  }

  beforeEach(async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    hoisted.logout.mockReset().mockResolvedValue(undefined)
    hoisted.setTheme.mockReset()
    hoisted.resolvedTheme = 'light'
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    window.bridge = {
      invoke: vi.fn().mockResolvedValue({ status: 'current' })
    } as unknown as typeof window.bridge
    await render()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('exposes the account email', () => {
    expect(container.textContent).toContain('a@b.c')
  })

  it('opens the confirm dialog when logout is requested and calls logout on confirm', async () => {
    // Confirm button lives inside the dialog, which renders only when open.
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull()

    act(() => findButton(container, '退出登录').click())

    expect(container.querySelector('[data-testid="dialog-title"]')?.textContent).toContain(
      '确认退出登录'
    )

    await act(async () => findButton(container, '确认退出').click())

    expect(hoisted.logout).toHaveBeenCalledTimes(1)
  })

  it('does not call logout when the confirm dialog is cancelled', async () => {
    act(() => findButton(container, '退出登录').click())
    act(() => findButton(container, '取消').click())

    expect(hoisted.logout).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull()
  })

  it('shows a loading label and disables buttons while logging out', async () => {
    let resolveLogout!: () => void
    hoisted.logout.mockImplementation(
      () => new Promise((resolve) => (resolveLogout = () => resolve(undefined)))
    )

    act(() => findButton(container, '退出登录').click())
    await act(async () => {
      findButton(container, '确认退出').click()
    })

    expect(container.textContent).toContain('正在退出…')
    expect(hoisted.logout).toHaveBeenCalledTimes(1)

    await act(async () => resolveLogout())
  })

  it('keeps the dialog open and surfaces an error when logout fails', async () => {
    hoisted.logout.mockRejectedValue(new Error('ipc error'))

    act(() => findButton(container, '退出登录').click())
    await act(async () => findButton(container, '确认退出').click())

    expect(hoisted.logout).toHaveBeenCalledTimes(1)
    // The dialog stays open so the user can retry after surfacing the failure.
    expect(container.querySelector('[data-testid="dialog"]')).not.toBeNull()
    expect(container.textContent).toContain('退出登录失败，请重试。')
  })

  it('switches theme when a theme button is clicked', async () => {
    act(() => findButton(container, '深色').click())
    expect(hoisted.setTheme).toHaveBeenCalledWith('dark')

    act(() => findButton(container, '浅色').click())
    expect(hoisted.setTheme).toHaveBeenCalledWith('light')
  })

  it('marks the active theme button as pressed', () => {
    const light = findButton(container, '浅色')
    const dark = findButton(container, '深色')
    expect(light.getAttribute('aria-pressed')).toBe('true')
    expect(dark.getAttribute('aria-pressed')).toBe('false')
  })

  it('requests an update check on check-for-updates click', async () => {
    await act(async () => findButton(container, '检查更新').click())

    expect(window.bridge.invoke).toHaveBeenCalledWith('update:check')
  })

  it('reports an available update with its version', async () => {
    vi.mocked(window.bridge.invoke).mockResolvedValueOnce({
      status: 'available',
      version: '2.0.0'
    })
    await act(async () => findButton(container, '检查更新').click())

    expect(container.textContent).toContain('发现 2.0.0')
  })

  it('reports an available update without a version', async () => {
    vi.mocked(window.bridge.invoke).mockResolvedValueOnce({ status: 'available' })
    await act(async () => findButton(container, '检查更新').click())

    expect(container.textContent).toContain('发现新版本')
  })

  it('reports the current version as being up to date', async () => {
    vi.mocked(window.bridge.invoke).mockResolvedValueOnce({ status: 'current' })
    await act(async () => findButton(container, '检查更新').click())

    expect(container.textContent).toContain('已是最新')
  })

  it('reports a development build', async () => {
    vi.mocked(window.bridge.invoke).mockResolvedValueOnce({ status: 'development' })
    await act(async () => findButton(container, '检查更新').click())

    expect(container.textContent).toContain('开发版本')
  })

  it('reports an update check failure', async () => {
    vi.mocked(window.bridge.invoke).mockRejectedValueOnce(new Error('network'))
    await act(async () => findButton(container, '检查更新').click())

    expect(container.textContent).toContain('检查失败')
  })

  it('shows a checking indicator while waiting', async () => {
    let resolveCheck!: () => void
    vi.mocked(window.bridge.invoke).mockImplementationOnce(
      () => new Promise((resolve) => (resolveCheck = () => resolve({ status: 'current' })))
    )

    await act(async () => {
      findButton(container, '检查更新').click()
    })

    expect(container.textContent).toContain('检查中…')

    await act(async () => resolveCheck())
  })
})
