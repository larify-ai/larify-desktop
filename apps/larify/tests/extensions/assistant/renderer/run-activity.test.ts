// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatRunDuration,
  RunActivity
} from '../../../../src/extensions/assistant/renderer/components/run-activity'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('RunActivity', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('formats clock durations', () => {
    expect(formatRunDuration(7)).toBe('00:07')
    expect(formatRunDuration(155)).toBe('02:35')
    expect(formatRunDuration(3755)).toBe('1:02:35')
  })

  it('keeps timing through streaming and preserves the completed duration', async () => {
    await act(async () => {
      root.render(createElement(RunActivity, { active: true, cancelled: false, failed: false }))
    })
    await act(async () => vi.advanceTimersByTimeAsync(2500))
    expect(container.textContent).toContain('00:02')
    expect(container.querySelector('[data-testid="run-active"]')).not.toBeNull()

    await act(async () => {
      root.render(createElement(RunActivity, { active: false, cancelled: false, failed: false }))
    })
    expect(container.textContent).toContain('00:02')
    expect(container.querySelector('[data-testid="run-completed"]')).not.toBeNull()
  })

  it('preserves the duration when cancelled', async () => {
    await act(async () => {
      root.render(createElement(RunActivity, { active: true, cancelled: false, failed: false }))
    })
    await act(async () => vi.advanceTimersByTimeAsync(1200))
    await act(async () => {
      root.render(createElement(RunActivity, { active: false, cancelled: true, failed: false }))
    })
    expect(container.textContent).toContain('00:01')
    expect(container.querySelector('[data-testid="run-cancelled"]')).not.toBeNull()
  })
})
