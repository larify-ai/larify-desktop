// @vitest-environment jsdom

import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

const captured = vi.hoisted(() => ({
  props: undefined as unknown,
  autoscrollToBottom: vi.fn(),
  scrollToIndex: vi.fn()
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function Virtuoso(props: unknown, ref) {
    captured.props = props
    useImperativeHandle(ref, () => ({
      autoscrollToBottom: captured.autoscrollToBottom,
      scrollToIndex: captured.scrollToIndex
    }))
    return null
  })
}))

import { AssistantMessageList } from '../../../src/renderer/src/app/interaction/assistant/message-list'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface VirtuosoProps {
  data: UIMessage[]
  followOutput: string
  initialTopMostItemIndex: number
  firstItemIndex: number
  startReached?: () => void
  role: string
  atBottomStateChange(atBottom: boolean): void
  computeItemKey(index: number, message: UIMessage): string
  itemContent(index: number, message: UIMessage): React.JSX.Element
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  captured.props = undefined
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
  it('starts at the latest message and follows output only from the bottom', () => {
    const messages = [message('first'), message('last')]

    renderToStaticMarkup(createElement(AssistantMessageList, { messages }))

    const props = captured.props as VirtuosoProps
    expect(props.data).toBe(messages)
    expect(props.initialTopMostItemIndex).toBe(1)
    expect(props.followOutput).toBe('auto')
    expect(props.role).toBe('log')
    expect(props.computeItemKey(1, messages[1])).toBe('last')
  })

  it('uses a valid initial index for an empty conversation', () => {
    renderToStaticMarkup(createElement(AssistantMessageList, { messages: [] }))

    expect((captured.props as VirtuosoProps).initialTopMostItemIndex).toBe(0)
  })

  it('preserves the viewport while loading older messages', () => {
    const onLoadOlder = vi.fn()
    renderToStaticMarkup(
      createElement(AssistantMessageList, {
        messages: [message('older'), message('latest')],
        firstItemIndex: 999_998,
        onLoadOlder
      })
    )

    const props = captured.props as VirtuosoProps
    expect(props.firstItemIndex).toBe(999_998)
    expect(props.initialTopMostItemIndex).toBe(999_999)
    props.startReached?.()
    expect(onLoadOlder).toHaveBeenCalledOnce()
  })

  it('delegates large conversations to Virtuoso without eagerly rendering messages', () => {
    const messages = Array.from({ length: 100_000 }, (_, index) => message(String(index)))

    renderToStaticMarkup(createElement(AssistantMessageList, { messages }))

    const props = captured.props as VirtuosoProps
    expect(props.data).toBe(messages)
    expect(props.data).toHaveLength(100_000)
    expect(props.initialTopMostItemIndex).toBe(99_999)
  })

  it('marks only the latest message as streaming', () => {
    const messages = [message('first'), message('last')]
    renderToStaticMarkup(createElement(AssistantMessageList, { messages, live: true }))

    const props = captured.props as VirtuosoProps
    expect(props.itemContent(0, messages[0]).props.children.props.streaming).toBe(false)
    expect(props.itemContent(1, messages[1]).props.children.props.streaming).toBe(true)
  })

  it('follows streaming growth only while the reader is at the bottom', async () => {
    const messages = [message('streaming')]
    await act(async () =>
      root.render(createElement(AssistantMessageList, { messages, live: true }))
    )
    captured.autoscrollToBottom.mockClear()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    await act(async () =>
      root.render(createElement(AssistantMessageList, { messages: [...messages], live: true }))
    )
    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    await act(async () =>
      root.render(createElement(AssistantMessageList, { messages: [...messages], live: true }))
    )
    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('offers a button that returns a scrolled conversation to the latest message', async () => {
    const messages = [message('first'), message('last')]
    await act(async () => root.render(createElement(AssistantMessageList, { messages })))
    expect(container.querySelector('button')).toBeNull()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))

    const button = container.querySelector<HTMLButtonElement>('[aria-label="返回底部"]')
    expect(button).not.toBeNull()
    act(() => button?.click())
    expect(captured.scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: 'end',
      behavior: 'smooth'
    })
  })

  it('does not offer a return button for an empty conversation', async () => {
    await act(async () => root.render(createElement(AssistantMessageList, { messages: [] })))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))

    expect(container.querySelector('button')).toBeNull()
  })

  it('returns to the absolute latest index after older messages are prepended', async () => {
    const messages = [message('older'), message('latest')]
    await act(async () =>
      root.render(createElement(AssistantMessageList, { messages, firstItemIndex: 999_998 }))
    )
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))

    act(() => container.querySelector<HTMLButtonElement>('button')?.click())

    expect(captured.scrollToIndex).toHaveBeenCalledWith({
      index: 999_999,
      align: 'end',
      behavior: 'smooth'
    })
  })
})

function message(id: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text: id }] }
}
