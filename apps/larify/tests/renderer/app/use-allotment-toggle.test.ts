// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAllotmentToggle } from '../../../src/renderer/src/app/layout/use-allotment-toggle'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The prop is TypeScript-validated; this ESLint rule only understands runtime PropTypes.
// eslint-disable-next-line react/prop-types
function ToggleHarness({ initiallyCollapsed = false }): React.JSX.Element {
  const panel = useAllotmentToggle(initiallyCollapsed)

  return createElement(
    'button',
    { 'data-collapsed': panel.collapsed, onClick: panel.toggle },
    'toggle'
  )
}

describe('useAllotmentToggle', () => {
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

  function button(): HTMLButtonElement {
    return container.querySelector('button')!
  }

  it('starts expanded and toggles synchronously', () => {
    act(() => root.render(createElement(ToggleHarness)))

    expect(button().dataset.collapsed).toBe('false')
    act(() => button().click())
    expect(button().dataset.collapsed).toBe('true')
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
  })
})
