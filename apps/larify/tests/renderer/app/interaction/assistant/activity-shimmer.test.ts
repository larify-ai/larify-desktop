// @vitest-environment jsdom
import { act, createElement, forwardRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const motionState = vi.hoisted(() => ({ reduced: false }))
vi.mock('motion/react', () => ({
  useReducedMotion: () => motionState.reduced,
  motion: {
    span: forwardRef<HTMLElement, Record<string, unknown>>(({ children, ...props }, ref) =>
      createElement('span', { ...props, ref }, children)
    )
  }
}))

import { ActivityShimmer } from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/activity-shimmer'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ActivityShimmer', () => {
  const container = document.createElement('div')
  const root = createRoot(container)

  beforeEach(() => {
    motionState.reduced = false
  })

  afterEach(async () => {
    await act(async () => root.render(null))
  })

  it('renders one text layer with a clipped foreground gradient', async () => {
    await act(async () =>
      root.render(
        createElement(
          ActivityShimmer,
          { className: 'text-foreground' },
          createElement('span', null, '处理中')
        )
      )
    )

    expect(container.textContent).toBe('处理中')
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(container.firstElementChild?.className).toContain('text-foreground')
    expect((container.firstElementChild as HTMLElement).style.backgroundClip).toBe('text')
    expect((container.firstElementChild as HTMLElement).style.backgroundImage).toContain(
      'linear-gradient'
    )
  })

  it('renders only the base content when reduced motion is requested', async () => {
    motionState.reduced = true
    await act(async () =>
      root.render(
        createElement(
          ActivityShimmer,
          { className: 'text-foreground' },
          createElement('span', null, '处理中')
        )
      )
    )

    expect(container.textContent).toBe('处理中')
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
