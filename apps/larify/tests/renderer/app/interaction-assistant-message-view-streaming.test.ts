import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const renderedParts = vi.hoisted(() => [] as Array<{ streaming: boolean; type: string }>)

vi.mock('../../../src/renderer/src/app/interaction/assistant/message-parts/message-part', () => ({
  MessagePart: ({ part, streaming }: { part: { type: string }; streaming: boolean }) => {
    renderedParts.push({ streaming, type: part.type })
    return null
  }
}))

import { MessageView } from '../../../src/renderer/src/app/interaction/assistant/message-view'

describe('interaction assistant message view streaming', () => {
  beforeEach(() => renderedParts.splice(0))

  it('keeps the last renderable part streaming when a snapshot follows it', () => {
    render([
      { type: 'text', text: 'before' },
      { type: 'text', text: 'after' },
      { type: 'data-git-snapshot', data: { files: [] } }
    ])

    expect(renderedParts).toEqual([
      { streaming: false, type: 'text' },
      { streaming: true, type: 'text' },
      { streaming: false, type: 'data-git-snapshot' }
    ])
  })

  it('does not mark any part as streaming after the message finishes', () => {
    render([{ type: 'text', text: 'done' }], false)

    expect(renderedParts).toEqual([{ streaming: false, type: 'text' }])
  })

  it('ignores an empty trailing placeholder when choosing the streaming part', () => {
    render([
      { type: 'text', text: 'visible' },
      { type: 'reasoning', text: '', state: 'streaming' }
    ])

    expect(renderedParts).toEqual([
      { streaming: true, type: 'text' },
      { streaming: false, type: 'reasoning' }
    ])
  })
})

function render(parts: unknown[], streaming = true): void {
  const message = { id: 'message-1', role: 'assistant', parts } as UIMessage
  renderToStaticMarkup(createElement(MessageView, { message, streaming }))
}
