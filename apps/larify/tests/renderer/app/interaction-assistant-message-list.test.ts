import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

const captured = vi.hoisted(() => ({ props: undefined as unknown }))

vi.mock('react-virtuoso', () => ({
  Virtuoso: (props: unknown) => {
    captured.props = props
    return null
  }
}))

import { AssistantMessageList } from '../../../src/renderer/src/app/interaction/assistant/message-list'

interface VirtuosoProps {
  data: UIMessage[]
  followOutput: string
  initialTopMostItemIndex: number
  computeItemKey(index: number, message: UIMessage): string
  itemContent(index: number, message: UIMessage): React.JSX.Element
}

beforeEach(() => {
  captured.props = undefined
})

describe('interaction assistant message list', () => {
  it('starts at the latest message and follows output only from the bottom', () => {
    const messages = [message('first'), message('last')]

    renderToStaticMarkup(createElement(AssistantMessageList, { messages }))

    const props = captured.props as VirtuosoProps
    expect(props.data).toBe(messages)
    expect(props.initialTopMostItemIndex).toBe(1)
    expect(props.followOutput).toBe('auto')
    expect(props.computeItemKey(1, messages[1])).toBe('last')
  })

  it('uses a valid initial index for an empty conversation', () => {
    renderToStaticMarkup(createElement(AssistantMessageList, { messages: [] }))

    expect((captured.props as VirtuosoProps).initialTopMostItemIndex).toBe(0)
  })

  it('delegates large conversations to Virtuoso without eagerly rendering messages', () => {
    const messages = Array.from({ length: 100_000 }, (_, index) => message(String(index)))

    renderToStaticMarkup(createElement(AssistantMessageList, { messages }))

    const props = captured.props as VirtuosoProps
    expect(props.data).toBe(messages)
    expect(props.data).toHaveLength(100_000)
    expect(props.initialTopMostItemIndex).toBe(99_999)
  })
})

function message(id: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text: id }] }
}
