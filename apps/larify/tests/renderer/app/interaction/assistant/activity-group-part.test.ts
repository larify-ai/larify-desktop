// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

vi.mock(
  '../../../../../src/renderer/src/app/interaction/assistant/message-parts/message-part',
  () => ({
    MessagePart: ({ part }: { part: { input?: { toolCallTitle?: string } } }) =>
      createElement('div', { 'data-detail': true }, part.input?.toolCallTitle)
  })
)
vi.mock(
  '../../../../../src/renderer/src/app/interaction/assistant/message-parts/message-markdown',
  () => ({
    MessageMarkdown: ({ children, isAnimating }: { children: string; isAnimating?: boolean }) =>
      createElement('div', { 'data-markdown': true, 'data-animating': isAnimating }, children)
  })
)

import { ActivityGroupPart } from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/activity-group-part'
import { MessageView } from '../../../../../src/renderer/src/app/interaction/assistant/message-view'
import type { AssistantRenderItem } from '../../../../../src/renderer/src/app/interaction/assistant/message-render-items'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const message: UIMessage = {
  id: 'assistant',
  role: 'assistant',
  parts: [
    {
      type: 'dynamic-tool',
      toolName: 'read',
      toolCallId: '1',
      state: 'output-available',
      input: { toolCallTitle: 'Read source' },
      output: 'done'
    }
  ]
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
})

describe('activity group part', () => {
  it('keeps the processing area expanded while the response is streaming', async () => {
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'activity-group',
            partIndexes: [0],
            summary: '处理了 0秒',
            defaultOpen: true,
            startedAt: Date.now(),
            children: [
              {
                kind: 'tool-group',
                partIndexes: [0],
                summary: 'Read source',
                defaultOpen: false
              }
            ]
          },
          message,
          streaming: true
        })
      )
    )

    const buttons = container.querySelectorAll('button')
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('处理了 0秒')
    expect(container.textContent).toContain('Read source')
    expect(container.querySelector('[data-shimmer-content]')).toBeNull()
  })

  it('shows a live text only once as a shimmering single-line title', async () => {
    const liveMessage = {
      id: 'assistant-live-text',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Inspecting the current implementation', state: 'streaming' }]
    } as UIMessage
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'activity-group',
            partIndexes: [0],
            summary: '处理了 1秒',
            defaultOpen: true,
            children: [
              {
                kind: 'intermediate-text',
                partIndexes: [0],
                summary: 'Inspecting the current implementation',
                defaultOpen: false
              }
            ]
          },
          message: liveMessage,
          streaming: true
        })
      )
    )

    const liveTitle = container.querySelector('[data-shimmer-content]')
    expect(liveTitle?.textContent).toContain('Inspecting the current implementation')
    expect(liveTitle?.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(container.querySelector('[data-markdown]')).toBeNull()
  })

  it('does not count a partial second as a completed second', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_999)
    try {
      await act(async () =>
        root.render(
          createElement(ActivityGroupPart, {
            item: {
              kind: 'status',
              partIndexes: [],
              summary: '处理了 0秒',
              defaultOpen: false,
              startedAt: 1_000
            },
            message,
            streaming: true
          })
        )
      )

      expect(container.textContent).toBe('处理了 0秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not mount tool details until expanded', async () => {
    await render(false)
    expect(container.textContent).toContain('Read source')
    expect(container.querySelector('[data-detail]')).toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click())
    expect(container.querySelector('[data-detail]')?.textContent).toBe('Read source')
  })

  it('renders expanded reasoning in the existing reasoning card', async () => {
    const reasoningMessage = {
      id: 'assistant-reasoning',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'Inspect the implementation' }]
    } as UIMessage
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'reasoning',
            partIndexes: [0],
            summary: 'Inspect the implementation',
            defaultOpen: true
          },
          message: reasoningMessage,
          streaming: false
        })
      )
    )

    const reasoning = container.querySelector('[data-reasoning-content]')
    expect(reasoning?.className).toContain('rounded-md')
    expect(reasoning?.className).toContain('border-border/70')
    expect(reasoning?.className).toContain('bg-muted/20')
    expect(reasoning?.className).toContain('px-3')
    expect(reasoning?.className).toContain('text-foreground')
    expect(reasoning?.className).not.toContain('text-muted-foreground')
    expect(reasoning?.textContent).toBe('Inspect the implementation')
  })

  it('preserves streaming semantics for an expanded live reasoning child', async () => {
    const reasoningMessage = {
      id: 'assistant-live-reasoning',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'Inspecting', state: 'streaming' }]
    } as UIMessage
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'activity-group',
            partIndexes: [0],
            summary: '处理了 1秒',
            defaultOpen: true,
            children: [
              {
                kind: 'reasoning',
                partIndexes: [0],
                summary: 'Inspecting',
                defaultOpen: true
              }
            ]
          },
          message: reasoningMessage,
          streaming: true
        })
      )
    )

    expect(container.querySelector('[data-markdown]')?.getAttribute('data-animating')).toBe('true')
  })

  it('uses explicit streaming state instead of assuming the last child is live', async () => {
    const reasoningMessage = {
      id: 'assistant-explicit-live-reasoning',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Still inspecting', state: 'streaming' },
        { type: 'reasoning', text: 'Later completed item', state: 'done' }
      ]
    } as UIMessage
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'activity-group',
            partIndexes: [0, 1],
            summary: '处理了 1秒',
            defaultOpen: true,
            children: [
              {
                kind: 'reasoning',
                partIndexes: [0],
                summary: 'Still inspecting',
                defaultOpen: true
              },
              {
                kind: 'reasoning',
                partIndexes: [1],
                summary: 'Later completed item',
                defaultOpen: true
              }
            ]
          },
          message: reasoningMessage,
          streaming: true
        })
      )
    )

    const markdown = container.querySelectorAll('[data-markdown]')
    expect(markdown[0]?.getAttribute('data-animating')).toBe('true')
    expect(markdown[1]?.getAttribute('data-animating')).toBe('false')
  })

  it('streams only the latest legacy reasoning child when part state is absent', async () => {
    const reasoningMessage = {
      id: 'assistant-legacy-reasoning',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Earlier reasoning' },
        { type: 'reasoning', text: 'Current reasoning' }
      ]
    } as UIMessage
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'activity-group',
            partIndexes: [0, 1],
            summary: '处理了 1秒',
            defaultOpen: true,
            children: [
              {
                kind: 'reasoning',
                partIndexes: [0],
                summary: 'Earlier reasoning',
                defaultOpen: true
              },
              {
                kind: 'reasoning',
                partIndexes: [1],
                summary: 'Current reasoning',
                defaultOpen: true
              }
            ]
          },
          message: reasoningMessage,
          streaming: true
        })
      )
    )

    const markdown = container.querySelectorAll('[data-markdown]')
    expect(markdown[0]?.getAttribute('data-animating')).toBe('false')
    expect(markdown[1]?.getAttribute('data-animating')).toBe('true')
  })

  it('ignores trailing whitespace when locating the latest legacy streaming part', async () => {
    const reasoningMessage = {
      id: 'assistant-legacy-reasoning-whitespace',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Current reasoning' },
        { type: 'text', text: '\n  \t' }
      ]
    } as UIMessage
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'activity-group',
            partIndexes: [0],
            summary: '处理了 1秒',
            defaultOpen: true,
            children: [
              {
                kind: 'reasoning',
                partIndexes: [0],
                summary: 'Current reasoning',
                defaultOpen: true
              }
            ]
          },
          message: reasoningMessage,
          streaming: true
        })
      )
    )

    expect(container.querySelector('[data-markdown]')?.getAttribute('data-animating')).toBe('true')
  })

  it('keeps original part indexes after missing parts are filtered', async () => {
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'tool-group',
            partIndexes: [99, 0],
            summary: 'Read source',
            defaultOpen: true
          },
          message,
          streaming: true
        })
      )
    )

    expect(container.querySelector('[data-detail]')?.textContent).toBe('Read source')
  })

  it('automatically folds an active group when the run completes', async () => {
    await render(true)
    expect(container.querySelector('[data-detail]')).not.toBeNull()

    await render(false)
    expect(container.querySelector('[data-detail]')).toBeNull()
  })

  it('opens when a live timer becomes a streaming activity group', async () => {
    await render(false)
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')

    await render(true)
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('respects a manual collapse while streaming updates continue', async () => {
    await render(true)
    const button = container.querySelector<HTMLButtonElement>('button')
    expect(button?.getAttribute('aria-expanded')).toBe('true')

    await act(async () => button?.click())
    expect(button?.getAttribute('aria-expanded')).toBe('false')

    await render(true)
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('restores an explicitly persisted open state on mount', async () => {
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'tool-group',
            partIndexes: [0],
            summary: 'Read source',
            defaultOpen: false
          },
          message,
          streaming: false,
          initialOpen: true
        })
      )
    )

    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-detail]')).not.toBeNull()
  })

  it('reports manual open-state changes to the parent', async () => {
    const onOpenChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'tool-group',
            partIndexes: [0],
            summary: 'Read source',
            defaultOpen: false
          },
          message,
          streaming: false,
          onOpenChange
        })
      )
    )

    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click())

    expect(onOpenChange).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('expands a completed turn in two stages', async () => {
    await act(async () =>
      root.render(
        createElement(ActivityGroupPart, {
          item: {
            kind: 'activity-group',
            partIndexes: [0],
            summary: 'Read source',
            defaultOpen: false,
            children: [
              {
                kind: 'tool-group',
                partIndexes: [0],
                summary: 'Read source',
                defaultOpen: false
              }
            ]
          },
          message,
          streaming: false
        })
      )
    )

    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.querySelector('[data-detail]')).toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click())
    expect(container.querySelectorAll('button')).toHaveLength(2)
    expect(container.querySelector('[data-detail]')).toBeNull()
    expect(container.querySelectorAll('button')[0]?.className).toContain('flex-wrap')
    expect(container.querySelectorAll('button')[0]?.className).toContain('text-muted-foreground')
    expect(container.querySelectorAll('button')[1]?.className).toContain('flex-nowrap')
    expect(container.querySelectorAll('button')[1]?.className).toContain('text-foreground')
    const arrows = container.querySelectorAll('button svg[class*="transition-"]')
    expect(arrows).toHaveLength(2)
    expect(arrows[0]?.getAttribute('class')).toContain('opacity-100')
    expect(arrows[1]?.getAttribute('class')).toContain('group-hover/summary:opacity-100')

    await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1]?.click())
    expect(container.querySelector('[data-detail]')?.textContent).toBe('Read source')
  })

  it('does not reset the live timer when streamed parts are appended', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(6_000)
    const streamingMessage = {
      id: 'assistant-timer',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'first' },
        { type: 'reasoning', text: 'second' }
      ]
    } as UIMessage
    const renderItem = (partIndexes: number[]): AssistantRenderItem => ({
      kind: 'activity-group' as const,
      partIndexes,
      summary: '处理了 0秒',
      defaultOpen: true,
      startedAt: 1_000,
      children: partIndexes.map((index) => ({
        kind: 'reasoning' as const,
        partIndexes: [index],
        summary: `reasoning ${index}`,
        defaultOpen: false
      }))
    })

    try {
      await act(async () =>
        root.render(
          createElement(MessageView, {
            message: streamingMessage,
            streaming: true,
            activityKey: 'assistant-timer-activity',
            renderItem: renderItem([0])
          })
        )
      )
      await act(async () => vi.advanceTimersByTime(0))
      expect(container.textContent).toContain('处理了 5秒')

      vi.setSystemTime(7_000)
      await act(async () =>
        root.render(
          createElement(MessageView, {
            message: streamingMessage,
            streaming: true,
            activityKey: 'assistant-timer-activity',
            renderItem: renderItem([0, 1])
          })
        )
      )

      expect(container.textContent).toContain('处理了 5秒')
      expect(container.textContent).not.toContain('处理了 0秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates a reused activity timer before paint when a new run starts', async () => {
    vi.useFakeTimers()
    const setInterval = vi.spyOn(window, 'setInterval')
    const clearInterval = vi.spyOn(window, 'clearInterval')
    const renderTimer = async (startedAt: number, streaming = true): Promise<void> => {
      await act(async () =>
        root.render(
          createElement(ActivityGroupPart, {
            item: {
              kind: 'activity-group',
              partIndexes: [0],
              summary: '处理过程',
              defaultOpen: streaming,
              startedAt,
              children: [
                {
                  kind: 'tool-group',
                  partIndexes: [0],
                  summary: 'Read source',
                  defaultOpen: false
                }
              ]
            },
            message,
            streaming
          })
        )
      )
    }

    try {
      vi.setSystemTime(6_000)
      await renderTimer(1_000)
      expect(container.textContent).toContain('处理了 5秒')
      expect(setInterval).toHaveBeenCalledTimes(1)

      vi.setSystemTime(7_000)
      await renderTimer(2_000)
      expect(container.textContent).toContain('处理了 5秒')
      expect(container.textContent).not.toContain('处理了 4秒')
      expect(setInterval).toHaveBeenCalledTimes(2)
      expect(clearInterval).toHaveBeenCalledTimes(1)

      await renderTimer(2_000, false)
      expect(clearInterval).toHaveBeenCalledTimes(2)
    } finally {
      setInterval.mockRestore()
      clearInterval.mockRestore()
      vi.useRealTimers()
    }
  })
})

async function render(defaultOpen: boolean): Promise<void> {
  await act(async () =>
    root.render(
      createElement(ActivityGroupPart, {
        item: {
          kind: 'tool-group',
          partIndexes: [0],
          summary: 'Read source',
          defaultOpen
        },
        message,
        streaming: defaultOpen
      })
    )
  )
}
