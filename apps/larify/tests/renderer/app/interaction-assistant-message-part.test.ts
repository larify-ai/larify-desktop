import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  reasoningProps: [] as Array<{ part: { type: string }; streaming: boolean }>,
  responseProps: [] as Array<{ children: string; isAnimating?: boolean }>,
  toolProps: [] as Array<{ part: { type: string } }>
}))

vi.mock('../../../src/renderer/src/components/ai-elements/message', () => ({
  MessageResponse: (props: { children: string; isAnimating?: boolean }) => {
    harness.responseProps.push(props)
    return props.children
  }
}))
vi.mock('../../../src/renderer/src/app/interaction/assistant/message-parts/reasoning-part', () => ({
  ReasoningPart: (props: { part: { type: string }; streaming: boolean }) => {
    harness.reasoningProps.push(props)
    return 'reasoning'
  }
}))
vi.mock('../../../src/renderer/src/app/interaction/assistant/message-parts/tool-part', () => ({
  ToolPart: (props: { part: { type: string } }) => {
    harness.toolProps.push(props)
    return 'tool'
  }
}))

import { MessagePart } from '../../../src/renderer/src/app/interaction/assistant/message-parts/message-part'

describe('interaction assistant message part', () => {
  beforeEach(() => {
    harness.reasoningProps.splice(0)
    harness.responseProps.splice(0)
    harness.toolProps.splice(0)
  })

  it('forwards the streaming state to markdown rendering', () => {
    renderToStaticMarkup(
      createElement(MessagePart, {
        part: { type: 'text', text: 'streaming' },
        streaming: true
      })
    )

    expect(harness.responseProps).toEqual([
      expect.objectContaining({ children: 'streaming', isAnimating: true })
    ])
  })

  it('stops markdown animation after streaming finishes', () => {
    render({ type: 'text', text: 'done' })

    expect(harness.responseProps).toEqual([
      expect.objectContaining({ children: 'done', isAnimating: false })
    ])
  })

  it('uses the text part state when it is available', () => {
    render({ type: 'text', text: 'part streaming', state: 'streaming' })
    render({ type: 'text', text: 'part done', state: 'done' }, true)

    expect(harness.responseProps).toEqual([
      expect.objectContaining({ children: 'part streaming', isAnimating: true }),
      expect.objectContaining({ children: 'part done', isAnimating: false })
    ])
  })

  it('does not mount markdown rendering for empty text', () => {
    expect(render({ type: 'text', text: '' })).toBe('')
    expect(harness.responseProps).toHaveLength(0)
  })

  it('forwards reasoning and streaming state to the reasoning renderer', () => {
    expect(render({ type: 'reasoning', text: 'thinking' }, true)).toBe('reasoning')
    expect(harness.reasoningProps).toEqual([
      expect.objectContaining({
        part: expect.objectContaining({ type: 'reasoning' }),
        streaming: true
      })
    ])
  })

  it('routes tool parts without leaking streaming state', () => {
    expect(
      render(
        {
          type: 'dynamic-tool',
          toolName: 'fs_read',
          toolCallId: 'call-1',
          state: 'input-available',
          input: {}
        },
        true
      )
    ).toBe('tool')
    expect(harness.toolProps).toEqual([{ part: expect.objectContaining({ type: 'dynamic-tool' }) }])
  })

  it('ignores unsupported data parts', () => {
    expect(render({ type: 'data-git-snapshot', data: {} })).toBe('')
  })
})

function render(part: unknown, streaming = false): string {
  return renderToStaticMarkup(
    createElement(MessagePart, {
      part: part as Parameters<typeof MessagePart>[0]['part'],
      streaming
    })
  )
}
