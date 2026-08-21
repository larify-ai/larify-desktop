// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger
} from '../../../../src/renderer/src/components/ai-elements/reasoning'

describe('Reasoning state', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('opens and closes after every streaming cycle', async () => {
    await render(true)
    expect(expanded()).toBe('true')

    await render(false)
    expect(expanded()).toBe('false')

    await render(true)
    expect(expanded()).toBe('true')

    await render(false)
    expect(expanded()).toBe('false')
  })

  it('shows a completed zero-second duration instead of a streaming label', async () => {
    await render(false, 0)

    expect(container.textContent).toContain('思考了 0 秒')
    expect(container.textContent).not.toContain('思考中')
  })

  it('allows the user to collapse reasoning while it is streaming', async () => {
    await render(true)
    expect(expanded()).toBe('true')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')?.click()
    })

    expect(expanded()).toBe('false')
  })

  it('respects an explicitly collapsed streaming panel', async () => {
    await render(true, undefined, false)

    expect(expanded()).toBe('false')
  })

  it('records the elapsed duration when streaming completes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    await render(true)

    vi.setSystemTime(new Date('2026-01-01T00:00:01.250Z'))
    await render(false)

    expect(container.textContent).toContain('思考了 2 秒')
  })

  async function render(
    isStreaming: boolean,
    duration?: number,
    defaultOpen?: boolean
  ): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          Reasoning,
          { defaultOpen, duration, isStreaming },
          createElement(ReasoningTrigger),
          createElement(ReasoningContent, null, 'details')
        )
      )
    })
  }

  function expanded(): string | null | undefined {
    return container
      .querySelector('[data-slot="collapsible-trigger"]')
      ?.getAttribute('aria-expanded')
  }
})
