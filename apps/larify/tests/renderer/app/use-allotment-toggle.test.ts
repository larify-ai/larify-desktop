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
    'div',
    null,
    createElement(
      'button',
      {
        'data-animating': panel.animating,
        'data-collapsed': panel.collapsed,
        onClick: panel.toggle
      },
      'toggle'
    ),
    createElement('button', { onClick: () => panel.setCollapsed(true) }, 'collapse')
  )
}

describe('useAllotmentToggle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function button(): HTMLButtonElement {
    return buttons()[0]
  }

  function buttons(): HTMLButtonElement[] {
    return [...container.querySelectorAll('button')]
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

  it('restarts the animation timeout from the latest toggle', () => {
    act(() => root.render(createElement(ToggleHarness)))

    act(() => button().click())
    act(() => vi.advanceTimersByTime(100))
    act(() => button().click())
    act(() => vi.advanceTimersByTime(179))
    expect(button().dataset.animating).toBe('true')

    act(() => vi.advanceTimersByTime(1))
    expect(button().dataset.animating).toBe('false')
  })

  it('does not animate an externally synchronized collapsed state', () => {
    act(() => root.render(createElement(ToggleHarness)))

    act(() => buttons()[1].click())

    expect(button().dataset.collapsed).toBe('true')
    expect(button().dataset.animating).toBe('false')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('toggles without an animation timer when reduced motion is requested', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    act(() => root.render(createElement(ToggleHarness)))

    act(() => button().click())

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(button().dataset.collapsed).toBe('true')
    expect(button().dataset.animating).toBe('false')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the animation timer when unmounted', () => {
    act(() => root.render(createElement(ToggleHarness)))
    act(() => button().click())
    expect(vi.getTimerCount()).toBe(1)

    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
  })
})
