// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  setTheme: vi.fn()
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: h.setTheme, theme: 'system' })
}))

import extension from '../../../../src/extensions/settings/renderer'
import { AppearanceSection } from '../../../../src/extensions/settings/renderer/components/appearance-section'
import { SettingsPane } from '../../../../src/extensions/settings/renderer/components/settings-pane'

const reactEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('settings renderer', () => {
  afterEach(() => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    h.setTheme.mockClear()
    document.body.replaceChildren()
  })

  it('registers the settings view with the correct sidebar label', () => {
    const registration = { dispose: vi.fn() }
    const register = vi.fn(() => registration)
    const subscriptions: { dispose(): void }[] = []

    extension.activate({ register } as never, { manifest: {}, subscriptions } as never)

    expect(register).toHaveBeenCalledWith(
      'view',
      'settings',
      expect.objectContaining({
        sidebar: expect.objectContaining({ label: '设置' })
      })
    )
    expect(subscriptions).toEqual([])
  })

  it('changes the selected appearance theme', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(AppearanceSection))
    })
    const system = container.querySelector<HTMLInputElement>('input[value="system"]')
    const dark = container.querySelector<HTMLInputElement>('input[value="dark"]')
    expect(system?.checked).toBe(true)
    expect(dark?.checked).toBe(false)

    await act(async () => {
      dark!.click()
    })
    expect(h.setTheme).toHaveBeenCalledWith('dark')

    await act(async () => {
      root.unmount()
    })
  })

  it('switches settings sections locally', async () => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(SettingsPane))
    })
    const appearance = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '外观'
    )

    await act(async () => {
      appearance!.click()
    })
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('外观')
    expect(container.textContent).toContain('系统')

    await act(async () => {
      root.unmount()
    })
  })
})
