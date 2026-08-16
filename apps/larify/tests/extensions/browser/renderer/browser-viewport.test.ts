// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserViewport } from '../../../../src/extensions/browser/renderer/browser-viewport'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class FakeResizeObserver {
  static instance: FakeResizeObserver | null = null

  constructor(private readonly cb: ResizeObserverCallback) {
    FakeResizeObserver.instance = this
  }
  observe(target: Element): void {
    this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  disconnect(): void {
    if (FakeResizeObserver.instance === this) FakeResizeObserver.instance = null
  }
  notify(target: Element): void {
    this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

describe('BrowserViewport', () => {
  let container: HTMLDivElement
  let root: Root
  let invoke: ReturnType<typeof vi.fn>
  let sendSync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    invoke = vi.fn().mockResolvedValue(undefined)
    sendSync = vi.fn()
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, sendSync }
    })
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: FakeResizeObserver
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 240,
      height: 200,
      left: 10,
      right: 310,
      top: 40,
      width: 300,
      x: 10,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    FakeResizeObserver.instance = null
  })

  it('shows the native browser view after its bounds are known', async () => {
    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 42, sessionId: 'session-a', visible: true })
      )
    )

    expect(invoke).toHaveBeenCalledWith('browser:setVisible', 'session-a', 42, false)
    expect(sendSync).toHaveBeenCalledWith('browser:setBoundsSync', 'session-a', 42, {
      height: 200,
      width: 300,
      x: 10,
      y: 40
    })
    expect(invoke).toHaveBeenCalledWith('browser:setVisible', 'session-a', 42, true)
  })

  it('deduplicates repeated observed layouts', async () => {
    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 42, sessionId: 'session-a', visible: true })
      )
    )
    const viewport = container.firstElementChild!
    sendSync.mockClear()
    await act(async () => {
      FakeResizeObserver.instance!.notify(viewport)
      FakeResizeObserver.instance!.notify(viewport)
    })

    expect(sendSync).toHaveBeenCalledTimes(0)
  })

  it('keeps an empty viewport hidden', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)

    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 42, sessionId: 'session-a', visible: true })
      )
    )

    expect(invoke).not.toHaveBeenCalledWith('browser:setVisible', 'session-a', 42, true)
  })

  it('clips native bounds to the collapsing Allotment pane', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
      if (this.classList.contains('split-view-view')) {
        return {
          bottom: 240,
          height: 200,
          left: 280,
          right: 310,
          top: 40,
          width: 30,
          x: 280,
          y: 40,
          toJSON: () => ({})
        } as DOMRect
      }
      return {
        bottom: 240,
        height: 200,
        left: 10,
        right: 310,
        top: 40,
        width: 300,
        x: 10,
        y: 40,
        toJSON: () => ({})
      } as DOMRect
    })

    await act(async () =>
      root.render(
        createElement(
          'div',
          { className: 'split-view-view' },
          createElement(BrowserViewport, {
            resourceId: 42,
            sessionId: 'session-a',
            visible: true
          })
        )
      )
    )

    expect(sendSync).toHaveBeenCalledWith('browser:setBoundsSync', 'session-a', 42, {
      height: 200,
      width: 30,
      x: 280,
      y: 40
    })
  })

  it('hides the previous resource when the viewport switches resources', async () => {
    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 42, sessionId: 'session-a', visible: true })
      )
    )
    invoke.mockClear()

    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 43, sessionId: 'session-a', visible: true })
      )
    )

    expect(invoke).toHaveBeenCalledWith('browser:setVisible', 'session-a', 42, false)
    expect(invoke).toHaveBeenCalledWith('browser:setVisible', 'session-a', 43, true)
  })

  it('hides the native view when the viewport becomes invisible', async () => {
    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 42, sessionId: 'session-a', visible: true })
      )
    )
    invoke.mockClear()

    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 42, sessionId: 'session-a', visible: false })
      )
    )

    expect(invoke).toHaveBeenCalledWith('browser:setVisible', 'session-a', 42, false)
  })

  it('reports bounds when a window resize changes only the viewport position', async () => {
    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 42, sessionId: 'session-a', visible: true })
      )
    )
    sendSync.mockClear()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 240,
      height: 200,
      left: 20,
      right: 320,
      top: 40,
      width: 300,
      x: 20,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)

    await act(async () => window.dispatchEvent(new Event('resize')))

    expect(sendSync).toHaveBeenCalledWith('browser:setBoundsSync', 'session-a', 42, {
      height: 200,
      width: 300,
      x: 20,
      y: 40
    })
  })

  it('reports bounds after Allotment completes a native layout', async () => {
    await act(async () =>
      root.render(
        createElement(BrowserViewport, { resourceId: 42, sessionId: 'session-a', visible: true })
      )
    )
    sendSync.mockClear()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 240,
      height: 200,
      left: 20,
      right: 320,
      top: 40,
      width: 300,
      x: 20,
      y: 40,
      toJSON: () => ({})
    } as DOMRect)

    await act(async () => window.dispatchEvent(new Event('larify:native-layout')))

    expect(sendSync).toHaveBeenCalledWith('browser:setBoundsSync', 'session-a', 42, {
      height: 200,
      width: 300,
      x: 20,
      y: 40
    })
  })

  it('derives size from rounded edges so the right edge stays fixed', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 240.4,
      height: 200,
      left: 10.6,
      right: 310.4,
      top: 40.4,
      width: 299.8,
      x: 10.6,
      y: 40.4,
      toJSON: () => ({})
    } as DOMRect)

    await act(async () =>
      root.render(
        createElement(BrowserViewport, {
          resourceId: 42,
          sessionId: 'session-a',
          visible: true
        })
      )
    )

    expect(sendSync).toHaveBeenCalledWith('browser:setBoundsSync', 'session-a', 42, {
      height: 200,
      width: 299,
      x: 11,
      y: 40
    })
  })
})
