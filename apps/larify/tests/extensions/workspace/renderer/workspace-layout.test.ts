// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceLayout } from '../../../../src/extensions/workspace/renderer/layout/workspace-layout'

describe('WorkspaceLayout', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('does not reserve navigator space when no navigator is provided', () => {
    render(true)

    expect(content().style.marginRight).toBe('0px')
    expect(separator()).toBeNull()
  })

  it('opens and closes the navigator without unmounting it', () => {
    render(true, createElement('button', { 'data-navigator': true }))

    expect(content().style.marginRight).toBe('200px')
    expect(navigator()?.getAttribute('data-open')).toBe('true')
    expect(navigator()?.hasAttribute('inert')).toBe(false)
    expect(separator()?.tabIndex).toBe(0)

    render(false, createElement('button', { 'data-navigator': true }))

    expect(content().style.marginRight).toBe('0px')
    expect(navigator()?.hasAttribute('data-open')).toBe(false)
    expect(navigator()?.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('[data-navigator]')).not.toBeNull()
    expect(separator()?.tabIndex).toBe(-1)
  })

  it('keeps the resized width after closing and reopening the navigator', () => {
    render(true, createElement('div'))
    const handle = separator()!
    handle.setPointerCapture = () => undefined
    handle.hasPointerCapture = () => true
    handle.releasePointerCapture = () => undefined

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', 300)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 220)))
    act(() => handle.dispatchEvent(pointerEvent('pointerup', 220)))
    expect(content().style.marginRight).toBe('280px')

    render(false, createElement('div'))
    expect(content().style.marginRight).toBe('0px')

    render(true, createElement('div'))
    expect(content().style.marginRight).toBe('280px')
    expect(separator()?.getAttribute('aria-valuenow')).toBe('280')
  })

  it('resizes the navigator with the keyboard and clamps its width', () => {
    render(true, createElement('div'))
    const handle = separator()
    expect(handle).not.toBeNull()

    for (let index = 0; index < 20; index += 1) press(handle!, 'ArrowLeft')
    expect(handle?.getAttribute('aria-valuenow')).toBe('320')
    expect(content().style.marginRight).toBe('320px')

    for (let index = 0; index < 30; index += 1) press(handle!, 'ArrowRight')
    expect(handle?.getAttribute('aria-valuenow')).toBe('160')
    expect(content().style.marginRight).toBe('160px')
  })

  it('ignores non-primary pointer buttons', () => {
    render(true, createElement('div'))
    const handle = separator()!
    handle.setPointerCapture = () => undefined

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', 300, 2)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 200)))

    expect(content().style.marginRight).toBe('200px')
    expect(container.querySelector('.workspace-layout')?.hasAttribute('data-resizing')).toBe(false)
  })

  it('stops resizing when the pointer interaction is cancelled', () => {
    render(true, createElement('div'))
    const handle = separator()!
    handle.setPointerCapture = () => undefined

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', 300)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 250)))
    expect(content().style.marginRight).toBe('250px')

    act(() => handle.dispatchEvent(pointerEvent('pointercancel', 250)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 200)))

    expect(content().style.marginRight).toBe('250px')
    expect(container.querySelector('.workspace-layout')?.hasAttribute('data-resizing')).toBe(false)
  })

  function render(navigatorOpen: boolean, navigator?: ReactNode): void {
    act(() =>
      root.render(
        createElement(
          WorkspaceLayout,
          { navigator, navigatorOpen },
          createElement('div', { 'data-content': true })
        )
      )
    )
  }

  function content(): HTMLElement {
    return container.querySelector('.workspace-layout-content')!
  }

  function navigator(): HTMLElement | null {
    return container.querySelector('.workspace-layout-navigator')
  }

  function separator(): HTMLElement | null {
    return container.querySelector('[role="separator"]')
  }
})

function press(element: HTMLElement, key: string): void {
  act(() => element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key })))
}

function pointerEvent(type: string, clientX: number, button = 0): Event {
  return new MouseEvent(type, { bubbles: true, button, clientX })
}
