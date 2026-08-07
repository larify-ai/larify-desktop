import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReasoningUIPart } from 'ai'

const captured = vi.hoisted(() => ({
  defaultOpen: undefined as boolean | undefined,
  isStreaming: undefined as boolean | undefined
}))

vi.mock('@renderer/components/ai-elements/reasoning', () => ({
  Reasoning: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
    Object.assign(captured, props)
    return children
  },
  ReasoningContent: ({ children }: React.PropsWithChildren) => children,
  ReasoningTrigger: () => null
}))

import { ReasoningPart } from '../../../src/renderer/src/app/interaction/assistant/message-parts/reasoning-part'

beforeEach(() => {
  captured.defaultOpen = undefined
  captured.isStreaming = undefined
})

describe('interaction assistant reasoning part', () => {
  it('does not mark completed reasoning as streaming', () => {
    render({ type: 'reasoning', text: 'done', state: 'done' }, true)

    expect(captured.isStreaming).toBe(false)
    expect(captured.defaultOpen).toBe(false)
  })

  it('uses the message streaming fallback only when the part state is absent', () => {
    render({ type: 'reasoning', text: 'thinking' }, true)

    expect(captured.isStreaming).toBe(true)
  })

  it('respects an explicit streaming part state', () => {
    render({ type: 'reasoning', text: 'thinking', state: 'streaming' }, false)

    expect(captured.isStreaming).toBe(true)
  })
})

function render(part: ReasoningUIPart, streaming: boolean): void {
  renderToStaticMarkup(createElement(ReasoningPart, { part, streaming }))
}
