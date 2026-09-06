// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewportBottomAnchor } from '../../../src/renderer/src/app/interaction/assistant/use-viewport-bottom-anchor'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let resize: (() => void) | null = null
let capture: ((range?: { startIndex: number; endIndex: number }) => void) | null = null
let trackRenderedRange: ((range: { startIndex: number; endIndex: number }) => void) | null = null
let releaseAnchor: (() => void) | null = null
let scrollToBottom: (() => void) | null = null
let observed: Element | null = null
let disconnected = false

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resize = () => callback([], this as unknown as ResizeObserver)
  }
  observe(element: Element): void {
    observed = element
  }
  disconnect(): void {
    disconnected = true
  }
}

function Harness({
  showScroller = true,
  resetKey
}: {
  showScroller?: boolean
  resetKey?: unknown
}): React.JSX.Element | null {
  const anchor = useViewportBottomAnchor(resetKey)
  useEffect(() => {
    capture = anchor.captureAnchor
    trackRenderedRange = anchor.trackRenderedRange
    releaseAnchor = anchor.releaseAnchor
    scrollToBottom = anchor.scrollToBottom
    return () => {
      capture = null
      trackRenderedRange = null
      releaseAnchor = null
      scrollToBottom = null
    }
  }, [anchor.captureAnchor, anchor.releaseAnchor, anchor.scrollToBottom, anchor.trackRenderedRange])
  if (!showScroller) return null
  return createElement(
    'div',
    { ref: anchor.scrollerRef, 'data-scroller': true },
    createElement('div', { 'data-message-index': '7' })
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  observed = null
  disconnected = false
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  resize = null
  capture = null
  trackRenderedRange = null
  releaseAnchor = null
  scrollToBottom = null
  vi.unstubAllGlobals()
})

describe('viewport bottom anchor', () => {
  it('tracks virtual ranges without reading layout until scrolling ends', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    const readViewport = vi.fn(() => rect(0, 400))
    const readItem = vi.fn(() => rect(200, 380))
    scroller.getBoundingClientRect = readViewport
    item.getBoundingClientRect = readItem
    await nextFrame()
    readViewport.mockClear()
    readItem.mockClear()

    trackRenderedRange?.({ startIndex: 7, endIndex: 7 })
    await nextFrame()

    expect(readViewport).not.toHaveBeenCalled()
    expect(readItem).not.toHaveBeenCalled()

    // 滚动（'scroll'）结束后经 150ms 无滚动事件节流才重新捕获锚定。
    scroller.dispatchEvent(new Event('scroll'))
    await flushScrollDebounce()

    expect(readViewport).toHaveBeenCalledOnce()
    expect(readItem).toHaveBeenCalledOnce()
  })

  it('does not rebuild a released anchor from a previously rendered range', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    const readViewport = vi.fn(() => rect(0, 400))
    const readItem = vi.fn(() => rect(200, 380))
    scroller.getBoundingClientRect = readViewport
    item.getBoundingClientRect = readItem
    await nextFrame()
    readViewport.mockClear()
    readItem.mockClear()

    trackRenderedRange?.({ startIndex: 7, endIndex: 7 })
    releaseAnchor?.()
    scroller.dispatchEvent(new Event('scrollend'))
    await nextFrame()

    expect(readViewport).not.toHaveBeenCalled()
    expect(readItem).not.toHaveBeenCalled()
  })

  it('keeps the initial rendered range when it arrives before the scroller', async () => {
    await act(async () => root.render(createElement(Harness, { showScroller: false })))
    captureIndex(7)
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let viewportBottom = 400
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    item.getBoundingClientRect = () => rect(200, 380)
    await nextFrame()

    viewportBottom = 300
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(100)
  })

  it('keeps the last visible item at the same distance from the viewport bottom', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let viewportBottom = 400
    const itemBottom = 380
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    item.getBoundingClientRect = () => rect(200, itemBottom)

    captureIndex(7)
    await nextFrame()

    viewportBottom = 300
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(100)
  })

  it('preserves the anchor when width changes reflow the visible message', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let itemBottom = 380
    scroller.getBoundingClientRect = () => rect(0, 400)
    item.getBoundingClientRect = () => rect(200, itemBottom)

    captureIndex(7)
    await nextFrame()

    itemBottom = 430
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(50)
  })

  it('ignores zero-sized updates while a conversation is hidden', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let viewport = rect(0, 400)
    scroller.getBoundingClientRect = () => viewport
    item.getBoundingClientRect = () => rect(200, 380)

    captureIndex(7)
    await nextFrame()

    viewport = { ...rect(0, 0), width: 0, right: 0 } as DOMRect
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(0)
  })

  it('does not restore after the conversation becomes hidden mid-frame', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let viewport = rect(0, 400)
    scroller.getBoundingClientRect = () => viewport
    item.getBoundingClientRect = () => rect(200, 380)

    captureIndex(7)
    await nextFrame()
    resize?.()
    viewport = { ...rect(0, 0), width: 0, right: 0 } as DOMRect
    await nextFrame()

    expect(scroller.scrollTop).toBe(0)
  })

  it('uses the latest reading position after the reader scrolls', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let viewportBottom = 400
    let itemBottom = 380
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    item.getBoundingClientRect = () => rect(200, itemBottom)

    captureIndex(7)
    await nextFrame()
    itemBottom = 340
    scroller.dispatchEvent(new Event('scroll'))
    await flushScrollDebounce()

    viewportBottom = 300
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(100)
  })

  it('moves the reading anchor to the last visible message after scrolling', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const previous = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    const current = document.createElement('div')
    current.dataset.messageIndex = '8'
    scroller.append(current)
    let viewportBottom = 400
    let previousBottom = 380
    let currentTop = 450
    let currentBottom = 500
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    previous.getBoundingClientRect = () => rect(previousBottom - 100, previousBottom)
    current.getBoundingClientRect = () => rect(currentTop, currentBottom)

    capture?.({ startIndex: 7, endIndex: 8 })
    await nextFrame()
    previousBottom = -100
    currentTop = 200
    currentBottom = 340
    scroller.dispatchEvent(new Event('scroll'))
    await flushScrollDebounce()

    viewportBottom = 300
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(100)
  })

  it('anchors the supplied visible item and ignores rendered overscan below it', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const first = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    const last = document.createElement('div')
    const overscan = document.createElement('div')
    last.dataset.messageIndex = '8'
    overscan.dataset.messageIndex = '9'
    scroller.append(last, overscan)
    let viewportBottom = 400
    let lastBottom = 390
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    first.getBoundingClientRect = () => rect(100, 350)
    last.getBoundingClientRect = () => rect(300, lastBottom)
    overscan.getBoundingClientRect = () => rect(450, 500)

    capture?.({ startIndex: 7, endIndex: 9 })
    await nextFrame()
    viewportBottom = 300
    lastBottom = 360
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(70)
  })

  it('prefers the last message whose bottom edge is actually visible', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const fullyVisible = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    const partiallyVisible = document.createElement('div')
    partiallyVisible.dataset.messageIndex = '8'
    scroller.append(partiallyVisible)
    let viewportBottom = 400
    let fullyVisibleBottom = 350
    let partiallyVisibleBottom = 450
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    fullyVisible.getBoundingClientRect = () => rect(200, fullyVisibleBottom)
    partiallyVisible.getBoundingClientRect = () => rect(350, partiallyVisibleBottom)

    capture?.({ startIndex: 7, endIndex: 8 })
    await nextFrame()
    viewportBottom = 300
    fullyVisibleBottom = 340
    partiallyVisibleBottom = 500
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(90)
  })

  it('falls back to an intersecting message when one message spans the viewport', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let viewportBottom = 400
    let itemBottom = 500
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    item.getBoundingClientRect = () => rect(-100, itemBottom)

    captureIndex(7)
    await nextFrame()
    viewportBottom = 300
    itemBottom = 550
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(150)
  })

  it('coalesces continuous resize updates into one frame', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let viewportBottom = 400
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    item.getBoundingClientRect = () => rect(200, 380)

    captureIndex(7)
    await nextFrame()
    viewportBottom = 350
    resize?.()
    viewportBottom = 300
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(100)
  })

  it('does not correct the scroll position during workbench dragging', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    container.className = 'larify-workbench-split'
    container.dataset.resizing = 'true'
    scroller.getBoundingClientRect = () => rect(0, 400)
    item.getBoundingClientRect = () => rect(200, 380)

    captureIndex(7)
    await nextFrame()
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(0)
  })

  it('restores the reading position after workbench dragging finishes', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    let viewportBottom = 400
    container.className = 'larify-workbench-split'
    scroller.getBoundingClientRect = () => rect(0, viewportBottom)
    item.getBoundingClientRect = () => rect(200, 380)

    captureIndex(7)
    await nextFrame()
    container.dataset.resizing = 'true'
    viewportBottom = 350
    resize?.()
    await nextFrame()
    expect(scroller.scrollTop).toBe(0)

    container.removeAttribute('data-resizing')
    viewportBottom = 300
    resize?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(100)
  })

  it('cancels a pending restore before positioning a newly active conversation', async () => {
    await act(async () => root.render(createElement(Harness, { resetKey: false })))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    scroller.getBoundingClientRect = () => rect(0, 400)
    item.getBoundingClientRect = () => rect(200, 380)

    captureIndex(7)
    await nextFrame()
    resize?.()
    await act(async () => root.render(createElement(Harness, { resetKey: true })))
    await nextFrame()

    expect(scroller.scrollTop).toBe(0)
  })

  it('cancels a pending restore and moves the scroller to the bottom', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    const item = container.querySelector<HTMLElement>('[data-message-index="7"]')!
    scroller.getBoundingClientRect = () => rect(0, 400)
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
    item.getBoundingClientRect = () => rect(200, 380)

    captureIndex(7)
    await nextFrame()
    resize?.()
    scrollToBottom?.()
    await nextFrame()

    expect(scroller.scrollTop).toBe(1000)
  })

  it('observes and disconnects the active scroller', async () => {
    await act(async () => root.render(createElement(Harness)))
    const scroller = container.querySelector<HTMLElement>('[data-scroller]')!
    expect(observed).toBe(scroller)

    act(() => root.render(null))
    expect(disconnected).toBe(true)
  })
})

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 800, width: 800, height: bottom - top } as DOMRect
}

function captureIndex(index: number): void {
  capture?.({ startIndex: index, endIndex: index })
}

async function nextFrame(): Promise<void> {
  await act(async () => new Promise((resolve) => requestAnimationFrame(resolve)))
}

// 滚动事件用"150ms 无滚动事件"近似滚动结束，触发 captureAnchor 重新捕获锚定，
// 捕获内部再经一帧 rAF 执行。故需等待真实 150ms 节流窗口 + 一帧。
async function flushScrollDebounce(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 170)))
  await nextFrame()
}
