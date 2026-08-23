// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('motion/react', () => ({ useReducedMotion: () => motion.reduced }))
vi.mock(
  '../../../../../src/renderer/src/app/interaction/assistant/message-parts/message-markdown',
  () => ({
    MessageMarkdown: ({ children, isAnimating }: { children: string; isAnimating: boolean }) =>
      createElement(
        'div',
        { 'data-markdown': true, 'data-animating': String(isAnimating) },
        children
      )
  })
)
vi.mock(
  '../../../../../src/renderer/src/app/interaction/assistant/message-parts/reasoning-part',
  () => ({ ReasoningPart: () => null })
)
vi.mock('../../../../../src/renderer/src/app/interaction/assistant/message-parts/tool-part', () => ({
  ToolPart: () => null
}))

import { MessagePart } from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/message-part'

describe('final answer replay', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    motion.reduced = false
    vi.useFakeTimers()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
  })

  it('progressively reveals the confirmed final text', async () => {
    const onComplete = vi.fn()
    await act(async () =>
      root.render(
        createElement(MessagePart, {
          part: { type: 'text', text: '这是最终回答，会渐进展示。' },
          streaming: false,
          replay: true,
          onReplayComplete: onComplete
        })
      )
    )

    expect(container.querySelector('[data-final-answer-replay]')).not.toBeNull()
    expect(container.querySelector('[data-markdown]')?.textContent).toBe('')

    await act(async () => vi.advanceTimersByTime(24))
    expect(container.querySelector('[data-markdown]')?.textContent?.length).toBeGreaterThan(0)
    expect(container.querySelector('[data-markdown]')?.getAttribute('data-animating')).toBe('true')

    await act(async () => vi.advanceTimersByTime(2_000))
    expect(container.querySelector('[data-markdown]')?.textContent).toBe(
      '这是最终回答，会渐进展示。'
    )
    expect(container.querySelector('[data-markdown]')?.getAttribute('data-animating')).toBe('false')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('shows the full answer immediately when reduced motion is enabled', async () => {
    motion.reduced = true
    const onComplete = vi.fn()
    await act(async () =>
      root.render(
        createElement(MessagePart, {
          part: { type: 'text', text: '完整回答' },
          streaming: false,
          replay: true,
          onReplayComplete: onComplete
        })
      )
    )

    expect(container.querySelector('[data-markdown]')?.textContent).toBe('完整回答')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
