// @vitest-environment jsdom

import { act, createElement, forwardRef, useEffect, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

const captured = vi.hoisted(() => ({
  props: undefined as unknown,
  mounts: 0,
  autoscrollToBottom: vi.fn()
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function Virtuoso(props: unknown, ref) {
    captured.props = props
    useEffect(() => {
      captured.mounts += 1
    }, [])
    useImperativeHandle(ref, () => ({
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
  initialTopMostItemIndex: { index: 'LAST'; align: 'end' } | number
  increaseViewportBy: { top: number; bottom: number }
  rangeChanged(range: { startIndex: number; endIndex: number }): void
  atBottomStateChange(atBottom: boolean): void
  computeItemKey(index: number): React.Key
  itemContent(index: number): React.JSX.Element
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  captured.mounts = 0
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
      recentStart: 4999
    })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(5000)
    expect(props.defaultItemHeight).toBe(80)
    expect(props.initialItemCount).toBe(12)
    expect(props.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' })
    expect(props.computeItemKey(4999)).toBe('latest')
    expect(props.className).toContain('[scrollbar-gutter:stable]')
    expect(props.scrollerRef).toEqual(expect.any(Function))
  })

  it('does not render initial placeholders for an empty conversation', async () => {
    await render({ messages: [], recentStart: 0 })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(0)
    expect(props.initialItemCount).toBe(0)
    expect(props.initialTopMostItemIndex).toBe(0)
  })

  it('prefetches pages around the visible range without changing the total count', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
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
      recentStart: 4999
    })

    const props = captured.props as VirtuosoProps
    expect(props).not.toHaveProperty('scrollSeekConfiguration')
    expect(props).not.toHaveProperty('components')
  })

  it('reports one buffered page range even when part of it is cached', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
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
      recentStart: 4999
    }
    await render(props)
    expect((captured.props as VirtuosoProps).totalCount).toBe(5000)

    await render({ ...props, messages: [...props.messages, message('appended')] })
    expect((captured.props as VirtuosoProps).totalCount).toBe(5001)
  })

  it('scrolls to the bottom when a mounted conversation becomes active', async () => {
    await render({
      active: false,
      messages: [message('first')],
      recentStart: 0
    })
    captured.autoscrollToBottom.mockClear()
    await render({
      active: true,
      messages: [message('second-latest')],
      recentStart: 4999
    })

    expect(captured.mounts).toBe(1)
    expect((captured.props as VirtuosoProps).initialTopMostItemIndex).toEqual({
      index: 'LAST',
      align: 'end'
    })
    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
  })

  it('positions once each time a mounted conversation is reactivated', async () => {
    const props = { messages: [message('latest')], recentStart: 0 }
    await render({ ...props, active: true })
    expect(captured.autoscrollToBottom).toHaveBeenCalledTimes(1)

    await render({ ...props, active: false })
    await render({ ...props, active: true })
    expect(captured.autoscrollToBottom).toHaveBeenCalledTimes(2)
  })

  it('scrolls to the bottom when initial messages finish restoring', async () => {
    await render({
      messages: [],
      recentStart: 0
    })
    captured.autoscrollToBottom.mockClear()

    await render({
      messages: [message('latest')],
      recentStart: 4999
    })

    expect(captured.mounts).toBe(1)
    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
  })

  it('hides the return button while the initial location is being measured', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 4999
    })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    expect(container.querySelector('button')).toBeNull()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    expect(container.querySelector('button')).not.toBeNull()
  })

  it('does not request historical pages when the conversation has no history', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
      recentStart: 0,
      onLoadRange
    })

    ;(captured.props as VirtuosoProps).rangeChanged({ startIndex: 0, endIndex: 0 })
    expect(onLoadRange).not.toHaveBeenCalled()
  })

  it('keeps following streaming growth when layout briefly reports away from bottom', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    captured.autoscrollToBottom.mockClear()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    await render({ ...props, messages: [...props.messages] })
    expect(captured.autoscrollToBottom).toHaveBeenCalled()

    captured.autoscrollToBottom.mockClear()
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    await render({ ...props, messages: [...props.messages] })
    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('pauses streaming follow after the reader scrolls upward', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    captured.autoscrollToBottom.mockClear()

    act(() => container.firstElementChild?.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    await render({ ...props, messages: [...props.messages] })

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
  })

  it('pauses streaming follow when the reader leaves the bottom without a wheel event', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [...props.messages] })

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
  })

  it('returns to the true bottom after initial positioning', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 4999
    })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()
    act(() => container.querySelector<HTMLButtonElement>('button')?.click())

    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
  })

  it('keeps unloaded items at the configured estimated height', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 4999
    })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(100)))
    expect(container.querySelector<HTMLElement>('[data-scroll-placeholder]')?.style.height).toBe(
      '80px'
    )
    expect(container.firstElementChild?.getAttribute('data-message-index')).toBe('100')
  })

  it('marks rendered messages as viewport anchor candidates', async () => {
    await render({ messages: [message('latest')], recentStart: 0 })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(0)))
    expect(container.firstElementChild?.getAttribute('data-message-index')).toBe('0')
  })

  it('reserves the rounded composer overlap inside the final message', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 0
    })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(0)))
    expect(container.firstElementChild?.className).toContain('pb-30')
  })
})

async function render({
  active = true,
  messages,
  recentStart,
  live = false,
  olderMessages = new Map(),
  onLoadRange = vi.fn()
}: {
  active?: boolean
  messages: UIMessage[]
  recentStart: number
  live?: boolean
  olderMessages?: Map<number, UIMessage>
  onLoadRange?: (firstPage: number, lastPage: number) => void
}): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AssistantMessageList, {
        active,
        messages,
        live,
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
