// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CircleIcon } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationAction } from '../../../src/renderer/src/app/navigation/navigation-action'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

function render(onClick?: () => void, iconClassName?: string): HTMLButtonElement {
  act(() => {
    root.render(
      createElement(NavigationAction, { icon: CircleIcon, onClick, iconClassName }, 'Action')
    )
  })
  return container.querySelector('button')!
}

describe('NavigationAction', () => {
  it('renders an accessible button with the default icon size', () => {
    const button = render()
    const icon = button.querySelector('svg')!

    expect(button.type).toBe('button')
    expect(button.textContent).toBe('Action')
    expect(button.className).toContain('focus-visible:bg-sidebar-accent')
    expect(icon.classList.contains('size-[18px]')).toBe(true)
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })

  it('supports icon sizing and click handling', () => {
    const onClick = vi.fn()
    const button = render(onClick, 'size-[17px]')

    act(() => button.click())
    expect(onClick).toHaveBeenCalledOnce()
    expect(button.querySelector('svg')?.classList.contains('size-[17px]')).toBe(true)
  })
})
