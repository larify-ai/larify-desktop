// @vitest-environment jsdom

import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

const captured = vi.hoisted(() => ({
  props: undefined as unknown,
  scrollToIndex: vi.fn(),
  scrollTo: vi.fn(),
  autoscrollToBottom: vi.fn()
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function Virtuoso(props: unknown, ref) {
    captured.props = props
    useImperativeHandle(ref, () => ({
      scrollToIndex: captured.scrollToIndex,
      scrollTo: captured.scrollTo,
      autoscrollToBottom: captured.autoscrollToBottom
    }))
    return null
  })
}))

import { AssistantMessageList } from '../../../src/renderer/src/app/interaction/assistant/message-list'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface VirtuosoProps {
  className: string
  scrollerRef(ref: HTMLElement | Window | null): void
  totalCount: number
  defaultItemHeight: number
  initialItemCount: number
  initialTopMostItemIndex: number
  increaseViewportBy: { top: number; bottom: number }
  components: {
    Footer: React.ComponentType
  }
  rangeChanged(range: { startIndex: number; endIndex: number }): void
  atBottomStateChange(atBottom: boolean): void
  computeItemKey(index: number): React.Key
  itemContent(index: number): React.JSX.Element
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('interaction assistant message list', () => {
  it('starts with a stable historical count and the latest item', async () => {
    await render({
      messages: [message('latest')],
      initialMessageCount: 5000,
      recentStart: 4999
    })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(5000)
    expect(props.defaultItemHeight).toBe(80)
    expect(props.initialItemCount).toBe(12)
    expect(props.initialTopMostItemIndex).toBe(4999)
    expect(props.computeItemKey(4999)).toBe('latest')
    expect(props.className).toContain('[scrollbar-gutter:stable_both-edges]')
    expect(props.scrollerRef).toEqual(expect.any(Function))
  })

  it('does not render initial placeholders for an empty conversation', async () => {
    await render({ messages: [], initialMessageCount: 0, recentStart: 0 })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(0)
    expect(props.initialItemCount).toBe(0)
  })

  it('prefetches pages around the visible range without changing the total count', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
      initialMessageCount: 5000,
      recentStart: 4999,
      onLoadRange
    })

    const props = captured.props as VirtuosoProps
    props.rangeChanged({ startIndex: 149, endIndex: 151 })

    expect(onLoadRange).toHaveBeenCalledOnce()
    expect(onLoadRange).toHaveBeenCalledWith(1, 4)
    expect(props.totalCount).toBe(5000)
    expect(props.increaseViewportBy).toEqual({ top: 600, bottom: 600 })
  })

  it('does not replace loaded messages with placeholders while scrolling', async () => {
    await render({
      messages: [message('latest')],
      initialMessageCount: 5000,
      recentStart: 4999
    })

    const props = captured.props as VirtuosoProps
    expect(props).not.toHaveProperty('scrollSeekConfiguration')
    expect(props.components).not.toHaveProperty('ScrollSeekPlaceholder')
  })

  it('reports one buffered page range even when part of it is cached', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
      initialMessageCount: 5000,
      recentStart: 4999,
      olderMessages: new Map([[100, message('loaded')]]),
      onLoadRange
    })

    ;(captured.props as VirtuosoProps).rangeChanged({ startIndex: 100, endIndex: 149 })
    expect(onLoadRange).toHaveBeenCalledOnce()
    expect(onLoadRange).toHaveBeenCalledWith(1, 3)
  })

  it('grows only when the agent appends a new message', async () => {
    const props = {
      messages: [message('latest')],
      initialMessageCount: 5000,
      recentStart: 4999
    }
    await render(props)
    expect((captured.props as VirtuosoProps).totalCount).toBe(5000)

    await render({ ...props, messages: [...props.messages, message('appended')] })
    expect((captured.props as VirtuosoProps).totalCount).toBe(5001)
  })

  it('does not request historical pages when the conversation has no history', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
      initialMessageCount: 1,
      recentStart: 0,
      onLoadRange
    })

    ;(captured.props as VirtuosoProps).rangeChanged({ startIndex: 0, endIndex: 0 })
    expect(onLoadRange).not.toHaveBeenCalled()
  })

  it('follows streaming growth only while the reader is at the bottom', async () => {
    const props = {
      messages: [message('streaming')],
      initialMessageCount: 1,
      recentStart: 0,
      live: true
    }
    await render(props)
    captured.autoscrollToBottom.mockClear()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    await render({ ...props, messages: [...props.messages] })
    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    await render({ ...props, messages: [...props.messages] })
    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('returns to the true bottom including the footer', async () => {
    await render({
      messages: [message('latest')],
      initialMessageCount: 5000,
      recentStart: 4999
    })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    act(() => container.querySelector<HTMLButtonElement>('button')?.click())

    expect(captured.scrollTo).toHaveBeenCalledWith({ top: Number.MAX_SAFE_INTEGER })
  })

  it('does not force the conversation to its absolute bottom after layout changes', async () => {
    await render({ messages: [message('latest')], initialMessageCount: 1, recentStart: 0 })
    captured.scrollTo.mockClear()

    act(() => window.dispatchEvent(new Event('larify:layout-toggle')))
    await act(async () => new Promise((resolve) => requestAnimationFrame(resolve)))

    expect(captured.scrollTo).not.toHaveBeenCalled()
  })

  it('keeps unloaded items at the configured estimated height', async () => {
    await render({
      messages: [message('latest')],
      initialMessageCount: 5000,
      recentStart: 4999
    })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(100)))
    expect(container.querySelector<HTMLElement>('[data-scroll-placeholder]')?.style.height).toBe(
      '80px'
    )
    expect(container.firstElementChild?.getAttribute('data-message-index')).toBe('100')
  })

  it('marks rendered messages as viewport anchor candidates', async () => {
    await render({ messages: [message('latest')], initialMessageCount: 1, recentStart: 0 })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(0)))
    expect(container.firstElementChild?.getAttribute('data-message-index')).toBe('0')
  })

  it('reserves the rounded composer overlap below the final message', async () => {
    await render({
      messages: [message('latest')],
      initialMessageCount: 1,
      recentStart: 0
    })

    await act(async () =>
      root.render(createElement((captured.props as VirtuosoProps).components.Footer))
    )
    expect(container.firstElementChild?.className).toContain('h-30')
  })
})

async function render({
  messages,
  initialMessageCount,
  recentStart,
  live = false,
  olderMessages = new Map(),
  onLoadRange = vi.fn()
}: {
  messages: UIMessage[]
  initialMessageCount: number
  recentStart: number
  live?: boolean
  olderMessages?: Map<number, UIMessage>
  onLoadRange?: (firstPage: number, lastPage: number) => void
}): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AssistantMessageList, {
        messages,
        live,
        initialMessageCount,
        recentStart,
        olderMessages,
        onLoadRange
      })
    )
  )
}

function message(id: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text: id }] }
}
