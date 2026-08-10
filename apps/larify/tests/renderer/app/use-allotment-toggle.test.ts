// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAllotmentToggle } from '../../../src/renderer/src/app/layout/use-allotment-toggle'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The prop is TypeScript-validated; this ESLint rule only understands runtime PropTypes.
// eslint-disable-next-line react/prop-types
function ToggleHarness({ initiallyCollapsed = false }): React.JSX.Element {
  const panel = useAllotmentToggle(initiallyCollapsed)

  return createElement(
    'button',
    {
      'data-animating': panel.animating,
      'data-collapsed': panel.collapsed,
      onClick: panel.toggle
    },
    'toggle'
  )
}

describe('useAllotmentToggle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function button(): HTMLButtonElement {
    return container.querySelector('button')!
  }

  it('starts expanded and toggles synchronously', () => {
    act(() => root.render(createElement(ToggleHarness)))

    expect(button().dataset.collapsed).toBe('false')
    expect(button().dataset.animating).toBe('false')
    act(() => button().click())
    expect(button().dataset.collapsed).toBe('true')
    expect(button().dataset.animating).toBe('true')
    act(() => vi.advanceTimersByTime(180))
    expect(button().dataset.animating).toBe('false')
    act(() => button().click())
    expect(button().dataset.collapsed).toBe('false')
  })

  it('supports an initially collapsed panel and repeated toggles', () => {
    act(() => root.render(createElement(ToggleHarness, { initiallyCollapsed: true })))

    expect(button().dataset.collapsed).toBe('true')
    act(() => {
      button().click()
      button().click()
      button().click()
    })
    expect(button().dataset.collapsed).toBe('false')
    expect(button().dataset.animating).toBe('true')
    act(() => vi.advanceTimersByTime(180))
    expect(button().dataset.animating).toBe('false')
  })

  it('clears the animation timer when unmounted', () => {
    act(() => root.render(createElement(ToggleHarness)))
    act(() => button().click())
    expect(vi.getTimerCount()).toBe(1)

    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
  })
})
