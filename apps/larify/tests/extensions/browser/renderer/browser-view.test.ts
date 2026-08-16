// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserTabState } from '../../../../src/extensions/browser/shared/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  back: vi.fn().mockResolvedValue(undefined),
  forward: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(true),
  reload: vi.fn().mockResolvedValue(undefined),
  state: null as BrowserTabState | null,
  useBrowser: vi.fn()
}))

vi.mock('../../../../src/extensions/browser/renderer/use-browser', () => ({
  useBrowser: (sessionId: string, resourceId: number) => {
    h.useBrowser(sessionId, resourceId)
    return h
  }
}))
vi.mock('../../../../src/extensions/browser/renderer/browser-viewport', () => ({
  BrowserViewport: ({
    children,
    resourceId,
    sessionId,
    visible
  }: {
    children?: ReactNode
    resourceId: number
    sessionId: string
    visible: boolean
  }) =>
    createElement(
      'div',
      {
        'data-resource-id': resourceId,
        'data-session-id': sessionId,
        'data-testid': 'browser-viewport',
        'data-visible': visible
      },
      children
    )
}))

import { BrowserView } from '../../../../src/extensions/browser/renderer/browser-view'

describe('BrowserView', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    h.state = null
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const renderView = async (): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(BrowserView, {
          active: true,
          resourceId: 42,
          sessionId: 'session-a',
          updateTab: vi.fn()
        })
      )
    })
  }

  it('shows the empty state and hides the native view for a blank tab', async () => {
    h.state = { id: 42, loading: true, url: 'about:blank' } as BrowserTabState
    await renderView()

    expect(container.textContent).toContain('开始浏览')
    expect(
      container.querySelector('[data-testid="browser-viewport"]')?.getAttribute('data-visible')
    ).toBe('false')
    expect(h.useBrowser).toHaveBeenCalledWith('session-a', 42)
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows a page and routes toolbar actions', async () => {
    h.state = {
      id: 42,
      canGoBack: true,
      canGoForward: true,
      url: 'https://example.com'
    } as BrowserTabState
    await renderView()

    expect(container.textContent).not.toContain('开始浏览')
    expect(
      container.querySelector('[data-testid="browser-viewport"]')?.getAttribute('data-visible')
    ).toBe('true')
    const buttons = container.querySelectorAll('button')
    await act(async () => {
      buttons[0].click()
      buttons[1].click()
      buttons[2].click()
    })
    expect(h.back).toHaveBeenCalledOnce()
    expect(h.forward).toHaveBeenCalledOnce()
    expect(h.reload).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-testid="browser-viewport"]')).toMatchObject({
      dataset: { resourceId: '42', sessionId: 'session-a' }
    })
  })

  it('hides the native view while its workbench tab is inactive', async () => {
    h.state = {
      id: 42,
      url: 'https://example.com'
    } as BrowserTabState
    await act(async () => {
      root.render(
        createElement(BrowserView, {
          active: false,
          resourceId: 42,
          sessionId: 'session-a',
          updateTab: vi.fn()
        })
      )
    })

    expect(
      container.querySelector('[data-testid="browser-viewport"]')?.getAttribute('data-visible')
    ).toBe('false')
  })

  it('hides the native view when the active workbench tab changes', async () => {
    h.state = {
      id: 42,
      url: 'https://example.com'
    } as BrowserTabState
    await renderView()

    await act(async () => {
      root.render(
        createElement(BrowserView, {
          active: false,
          resourceId: 42,
          sessionId: 'session-a',
          updateTab: vi.fn()
        })
      )
    })

    expect(
      container.querySelector('[data-testid="browser-viewport"]')?.getAttribute('data-visible')
    ).toBe('false')
  })

  it('routes address navigation and contains rejected toolbar operations', async () => {
    h.state = {
      id: 42,
      canGoBack: true,
      canGoForward: true,
      url: 'https://example.com'
    } as BrowserTabState
    h.back.mockRejectedValueOnce(new Error('back failed'))
    h.forward.mockRejectedValueOnce(new Error('forward failed'))
    h.reload.mockRejectedValueOnce(new Error('reload failed'))
    await renderView()

    const buttons = container.querySelectorAll('button')
    await act(async () => {
      buttons[0].click()
      buttons[1].click()
      buttons[2].click()
      buttons[3].click()
    })
    const input = container.querySelector('input')!
    await act(async () => {
      input.value = 'example.org'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()
    })

    expect(h.navigate).toHaveBeenCalledWith('example.org')
  })
})
