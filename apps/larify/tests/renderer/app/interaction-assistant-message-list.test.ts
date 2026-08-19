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
let resize: () => void

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    resize = () => callback([], this as unknown as ResizeObserver)
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  captured.mounts = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
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

  it('re-renders a streaming message when the chat mutates its existing object', async () => {
    const streamingMessage = message('partial')
    const itemContainer = document.createElement('div')
    document.body.append(itemContainer)
    const itemRoot = createRoot(itemContainer)
    try {
      await render({ messages: [streamingMessage], recentStart: 0, live: true })
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))
      expect(itemContainer.textContent).toContain('partial')

      const textPart = streamingMessage.parts[0]
      if (textPart.type !== 'text') throw new Error('expected a text part')
      textPart.text = 'complete streamed text'
      await render({ messages: [streamingMessage], recentStart: 0, live: true })
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))

      expect(itemContainer.textContent).toContain('complete streamed text')
    } finally {
      await act(async () => itemRoot.unmount())
      itemContainer.remove()
    }
  })

  it('waits for an assistant message before marking streaming content', async () => {
    const assistant = message('assistant')
    const user: UIMessage = {
      id: 'user',
      role: 'user',
      parts: [{ type: 'text', text: 'next request' }]
    }
    await render({ messages: [assistant, user], recentStart: 0, live: true })

    const props = captured.props as VirtuosoProps
    expect(props.itemContent(0).props.children.props.streaming).toBe(false)
    expect(props.itemContent(1).props.children.props.streaming).toBe(false)

    const response = message('response')
    await render({ messages: [assistant, user, response], recentStart: 0, live: true })
    const updated = captured.props as VirtuosoProps
    expect(updated.itemContent(0).props.children.props.streaming).toBe(false)
    expect(updated.itemContent(2).props.children.props.streaming).toBe(true)
  })

  it('resumes following after a tool output is submitted', async () => {
    const props = { messages: [message('latest')], recentStart: 0 }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, followRequest: 1 })

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
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
    expect(container.querySelector('button')).toBeNull()
  })

  it('shows the return button only after the reader leaves the bottom tolerance', async () => {
    await render({ messages: [message('latest')], recentStart: 0 })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))

    scroller.scrollTop = 80
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    expect(container.querySelector('button')).toBeNull()

    scroller.scrollTop = 60
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    expect(container.querySelector('button')).not.toBeNull()

    scroller.scrollTop = 86
    act(() => scroller.dispatchEvent(new Event('scroll')))
    expect(container.querySelector('button')).toBeNull()
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
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
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
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [...props.messages] })

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
  })

  it('cancels pending scroll intent when the conversation is hidden', async () => {
    const props = { messages: [message('streaming')], recentStart: 0, live: true }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))

    await render({ ...props, active: false })
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    await render({ ...props, active: true, messages: [message('streaming longer')] })

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('ignores scroll corrections while positioning the conversation', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const detach = content.props.ref(document.createElement('div'))
    act(() => resize())
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
    detach()
  })

  it('continues following when a growing message corrects the scroll position', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const detach = content.props.ref(document.createElement('div'))
    act(() => resize())
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [message('streaming longer')] })

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
    detach()
  })

  it('follows asynchronous height growth inside the streaming message', async () => {
    await render({ messages: [message('streaming')], recentStart: 0, live: true })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const element = document.createElement('div')
    const detach = content.props.ref(element)
    captured.autoscrollToBottom.mockClear()

    act(() => resize())

    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
    detach()
  })

  it('keeps observing a long final message with tool cards after streaming completes', async () => {
    const finalMessage = complexMessage()
    await render({ messages: [finalMessage], recentStart: 0, live: true })
    const streamingContent = (captured.props as VirtuosoProps).itemContent(0)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const detach = streamingContent.props.ref(document.createElement('div'))

    await render({ messages: [finalMessage], recentStart: 0, live: false })
    const completedContent = (captured.props as VirtuosoProps).itemContent(0)

    expect(streamingContent.props.ref).toEqual(expect.any(Function))
    expect(completedContent.props.ref).toBe(streamingContent.props.ref)
    captured.autoscrollToBottom.mockClear()
    act(() => resize())
    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
    detach()
  })

  it('does not follow height growth after the reader scrolls upward', async () => {
    await render({ messages: [message('streaming')], recentStart: 0, live: true })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const detach = content.props.ref(document.createElement('div'))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    captured.autoscrollToBottom.mockClear()

    act(() => resize())

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
    detach()
  })

  it('ignores scrolling inside message content while following output', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    const scroller = document.createElement('div')
    const nestedScroller = document.createElement('div')
    scroller.append(nestedScroller)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    nestedScroller.scrollTop = 50
    act(() => nestedScroller.dispatchEvent(new Event('scroll')))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [message('streaming longer')] })

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('returns to the true bottom after initial positioning', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 4999
    })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 60
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
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

  it('visually joins consecutive assistant messages without merging their data', async () => {
    const user: UIMessage = {
      id: 'user',
      role: 'user',
      parts: [{ type: 'text', text: 'next request' }]
    }
    await render({
      messages: [message('first'), message('second'), user],
      recentStart: 0
    })

    const props = captured.props as VirtuosoProps
    expect(props.itemContent(0).props.className).toContain('pb-0')
    expect(props.itemContent(1).props.className).toContain('pt-0')
    expect(props.itemContent(1).props.className).toContain('pb-3')
    expect(props.itemContent(2).props.className).toContain('pt-3')
    expect(props.computeItemKey(0)).toBe('first')
    expect(props.computeItemKey(1)).toBe('second')
  })

  it('reserves the rounded composer overlap inside the final message', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 0
    })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(0)))
    expect(container.firstElementChild?.className).toContain('pb-30')
    expect(container.firstElementChild?.className).toContain(
      'translate-x-[calc(var(--larify-scrollbar-size)/2)]'
    )
    expect(container.firstElementChild?.className).toContain(
      'w-[calc(100%-var(--larify-scrollbar-size))]'
    )
  })
})

async function render({
  active = true,
  messages,
  recentStart,
  live = false,
  followRequest = 0,
  olderMessages = new Map(),
  onLoadRange = vi.fn()
}: {
  active?: boolean
  messages: UIMessage[]
  recentStart: number
  live?: boolean
  followRequest?: number
  olderMessages?: Map<number, UIMessage>
  onLoadRange?: (firstPage: number, lastPage: number) => void
}): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AssistantMessageList, {
        active,
        messages,
        live,
        followRequest,
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

function complexMessage(): UIMessage {
  return {
    id: 'long-final-message',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'long text '.repeat(2000) },
      {
        type: 'dynamic-tool',
        toolName: 'browser_screenshot',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { toolCallTitle: '截取完整页面' },
        output: { path: 'page.png' }
      },
      {
        type: 'dynamic-tool',
        toolName: 'browser_pdf',
        toolCallId: 'call-2',
        state: 'output-available',
        input: { toolCallTitle: '保存页面为 PDF' },
        output: { path: 'page.pdf' }
      },
      { type: 'text', text: '| 文件 | 大小 |\n| --- | ---: |\n| page.png | 26007 |' }
    ]
  }
}

function createScroller(scrollTop: number): HTMLDivElement {
  const scroller = document.createElement('div')
  Object.defineProperties(scroller, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 200 }
  })
  scroller.scrollTop = scrollTop
  return scroller
}
