// @vitest-environment jsdom

import { act, createElement } from 'react'
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
  useBrowser: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../../src/extensions/browser/renderer/use-browser', () => ({
  useBrowser: (sessionId: string, resourceId: number) => {
    h.useBrowser(sessionId, resourceId)
    return h
  }
}))
import { BrowserView } from '../../../../src/extensions/browser/renderer/browser-view'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('BrowserView', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    h.state = null
    vi.clearAllMocks()
    window.bridge = { invoke: h.invoke } as unknown as typeof window.bridge
    globalThis.ResizeObserver = class {
      observe(): void {
        return undefined
      }
      unobserve(): void {
        return undefined
      }
      disconnect(): void {
        return undefined
      }
    }
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

  const webview = (): Electron.WebviewTag =>
    document.body.querySelector('[data-browser-webview-host="42"] webview') as Electron.WebviewTag

  it('shows the empty state over a blank webview', async () => {
    h.state = { id: 42, loading: true, url: 'about:blank' } as BrowserTabState
    await renderView()

    expect(container.textContent).toContain('开始浏览')
    const guest = webview()
    expect(guest.getAttribute('partition')).toBe('persist:larify-browser')
    expect(guest.getAttribute('src')).toBe('about:blank')
    expect(guest.getAttribute('webpreferences')).toBe(
      'backgroundThrottling=yes, contextIsolation=yes, nodeIntegration=no, sandbox=yes'
    )
    expect(guest.hasAttribute('allowpopups')).toBe(true)
    expect(guest.parentElement?.style.left).toBe('-10000px')
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
    expect(webview()).toBeTruthy()
    const buttons = container.querySelectorAll('button')
    await act(async () => {
      buttons[0].click()
      buttons[1].click()
      buttons[2].click()
    })
    expect(h.back).toHaveBeenCalledOnce()
    expect(h.forward).toHaveBeenCalledOnce()
    expect(h.reload).toHaveBeenCalledOnce()
  })

  it('reveals a resized page only after two animation frames', async () => {
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => frames.push(callback))
    h.state = { id: 42, url: 'https://example.com' } as BrowserTabState
    await renderView()

    const host = webview().parentElement!
    expect(host.style.visibility).toBe('hidden')
    act(() => frames.shift()!(0))
    expect(host.style.visibility).toBe('hidden')
    act(() => frames.shift()!(16))
    expect(host.style.visibility).toBe('')
    requestFrame.mockRestore()
  })

  it('updates the visible host when native layout changes without a resize', async () => {
    h.state = { id: 42, url: 'https://example.com' } as BrowserTabState
    await renderView()
    const viewport = container.querySelector('[data-testid="browser-viewport"]') as HTMLDivElement
    viewport.getBoundingClientRect = vi.fn(() =>
      DOMRect.fromRect({
        x: 11,
        y: 22,
        width: 333,
        height: 444
      })
    )
    window.dispatchEvent(new CustomEvent('larify:native-layout'))

    expect(webview().parentElement?.style.cssText).toContain('left: 11px')
    expect(webview().parentElement?.style.cssText).toContain('top: 22px')
    expect(webview().parentElement?.style.cssText).toContain('width: 333px')
    expect(webview().parentElement?.style.cssText).toContain('height: 444px')
  })

  it('keeps the webview mounted while its workbench tab is inactive', async () => {
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

    expect(webview()).toBeTruthy()
    expect(webview().parentElement?.style.left).toBe('-10000px')
  })

  it('keeps the same webview when the active workbench tab changes', async () => {
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

    expect(document.body.querySelectorAll('[data-browser-webview-host="42"] webview')).toHaveLength(
      1
    )
  })

  it('parks an inactive webview at its last visible rendering size', async () => {
    vi.useFakeTimers()
    h.state = { id: 42, url: 'https://example.com' } as BrowserTabState
    await renderView()
    const viewport = container.querySelector('[data-testid="browser-viewport"]') as HTMLDivElement
    viewport.getBoundingClientRect = vi.fn(() =>
      DOMRect.fromRect({ x: 20, y: 30, width: 2560, height: 1400 })
    )
    window.dispatchEvent(new CustomEvent('larify:native-layout'))

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

    const style = webview().parentElement!.style
    expect(style.left).toBe('-10000px')
    expect(style.top).toBe('-10000px')
    expect(style.width).toBe('2560px')
    expect(style.height).toBe('1400px')
    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    expect(style.width).toBe('2560px')
    expect(style.height).toBe('1400px')
    vi.useRealTimers()
  })

  it('isolates a leased webview from user layout changes and tab switches', async () => {
    h.state = { id: 42, url: 'https://example.com' } as BrowserTabState
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
    const guest = webview()
    const host = guest.parentElement!
    host.dataset.browserRendering = 'true'
    host.style.left = '0px'
    host.style.top = '0px'
    window.dispatchEvent(new Event('resize'))

    expect(host.style.left).toBe('0px')
    expect(host.style.zIndex).toBe('-1')

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
    expect(webview()).toBe(guest)
    expect(host.style.zIndex).toBe('')

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
    expect(host.style.left).toBe('0px')
    expect(host.style.zIndex).toBe('-1')
  })

  it('registers the guest WebContents when the webview is ready', async () => {
    await renderView()
    const guest = webview()
    guest.getWebContentsId = vi.fn(() => 99)
    await act(async () => guest.dispatchEvent(new Event('did-attach')))
    await act(async () => guest.dispatchEvent(new Event('did-attach')))

    expect(h.invoke).toHaveBeenCalledWith('browser:attach', 'session-a', 42, 99)
    expect(h.invoke.mock.calls.filter(([channel]) => channel === 'browser:attach')).toHaveLength(1)
  })

  it('retries guest registration after a failed attachment', async () => {
    h.invoke.mockImplementation((channel: string) =>
      channel === 'browser:attach' ? Promise.reject(new Error('not ready')) : Promise.resolve()
    )
    await renderView()
    const guest = webview()
    guest.getWebContentsId = vi.fn(() => 99)
    await act(async () => guest.dispatchEvent(new Event('dom-ready')))
    h.invoke.mockResolvedValue(undefined)
    await act(async () => guest.dispatchEvent(new Event('dom-ready')))

    expect(h.invoke.mock.calls.filter(([channel]) => channel === 'browser:attach')).toHaveLength(2)
  })

  it('registers a replacement guest created in the same webview', async () => {
    await renderView()
    const guest = webview()
    let webContentsId = 99
    guest.getWebContentsId = vi.fn(() => webContentsId)
    await act(async () => guest.dispatchEvent(new Event('dom-ready')))

    webContentsId = 100
    await act(async () => guest.dispatchEvent(new Event('dom-ready')))

    expect(h.invoke).toHaveBeenNthCalledWith(1, 'browser:attach', 'session-a', 42, 99)
    expect(h.invoke).toHaveBeenNthCalledWith(2, 'browser:attach', 'session-a', 42, 100)
  })

  it('registers a replacement guest created while attachment is pending', async () => {
    const first = deferred<unknown>()
    h.invoke.mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    await renderView()
    const guest = webview()
    let webContentsId = 99
    guest.getWebContentsId = vi.fn(() => webContentsId)
    act(() => guest.dispatchEvent(new Event('did-attach')))

    webContentsId = 100
    act(() => guest.dispatchEvent(new Event('did-attach')))
    first.resolve(undefined)
    await act(async () => first.promise)

    expect(h.invoke).toHaveBeenNthCalledWith(1, 'browser:attach', 'session-a', 42, 99)
    expect(h.invoke).toHaveBeenNthCalledWith(2, 'browser:attach', 'session-a', 42, 100)
  })

  it('parks the webview when the workbench panel is collapsed', async () => {
    h.state = { id: 42, url: 'https://example.com' } as BrowserTabState
    await renderView()
    const viewport = container.querySelector('[data-testid="browser-viewport"]') as HTMLDivElement
    viewport.getBoundingClientRect = vi.fn(() =>
      DOMRect.fromRect({ x: 11, y: 22, width: 333, height: 444 })
    )
    window.dispatchEvent(new CustomEvent('larify:native-layout'))
    const host = webview().parentElement!
    expect(host.style.left).toBe('11px')

    // 折叠工作台：派发可见性 false，webview 应移出屏幕
    await act(async () => {
      window.dispatchEvent(new CustomEvent('larify:workbench-animation', { detail: { visible: false } }))
    })
    expect(host.style.left).toBe('-10000px')
    expect(host.style.top).toBe('-10000px')

    // 重新展开：派发可见性 true，webview 恢复正常定位
    await act(async () => {
      window.dispatchEvent(new CustomEvent('larify:workbench-animation', { detail: { visible: true } }))
      window.dispatchEvent(new CustomEvent('larify:native-layout'))
    })
    expect(host.style.left).toBe('11px')
    expect(host.style.top).toBe('22px')
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
