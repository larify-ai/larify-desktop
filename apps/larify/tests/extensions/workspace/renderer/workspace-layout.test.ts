// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-empty-function */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    vi.unstubAllGlobals()
  })

  it('does not reserve navigator space when no navigator is provided', () => {
    render(true)

    expect(content().style.marginRight).toBe('0px')
    expect(separator()).toBeNull()
  })

  it('opens and closes the navigator without unmounting it', () => {
    render(true, createElement('button', { 'data-navigator': true }))

    expect(content().style.marginRight).toBe('260px')
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
    expect(content().style.marginRight).toBe('340px')

    render(false, createElement('div'))
    expect(content().style.marginRight).toBe('0px')

    render(true, createElement('div'))
    expect(content().style.marginRight).toBe('340px')
    expect(separator()?.getAttribute('aria-valuenow')).toBe('340')
  })

  it('resizes the navigator with the keyboard and clamps its width', () => {
    render(true, createElement('div'))
    const handle = separator()
    expect(handle).not.toBeNull()

    for (let index = 0; index < 30; index += 1) press(handle!, 'ArrowLeft')
    expect(handle?.getAttribute('aria-valuenow')).toBe('520')
    expect(content().style.marginRight).toBe('520px')

    for (let index = 0; index < 50; index += 1) press(handle!, 'ArrowRight')
    expect(handle?.getAttribute('aria-valuenow')).toBe('160')
    expect(content().style.marginRight).toBe('160px')
  })

  it('preserves the minimum content width instead of hiding during resize', () => {
    render(true, createElement('div'))
    const body = container.querySelector<HTMLElement>('.workspace-layout-body')!
    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 500 })
    const handle = separator()!
    handle.setPointerCapture = () => undefined
    handle.hasPointerCapture = () => true
    handle.releasePointerCapture = () => undefined

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', 300)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 100)))
    act(() => handle.dispatchEvent(pointerEvent('pointerup', 100)))

    expect(content().style.marginRight).toBe('220px')
    expect(navigator()?.getAttribute('data-open')).toBe('true')
  })

  it('keeps one ResizeObserver while the navigator is dragged', () => {
    let observerCount = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor() {
          observerCount += 1
        }
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      }
    )
    render(true, createElement('div'))
    const handle = separator()!
    handle.setPointerCapture = () => undefined

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', 300)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 280)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 260)))

    expect(observerCount).toBe(1)
  })

  it('observes only while the workspace is visible', () => {
    let observeCount = 0
    let disconnectCount = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {
          observeCount += 1
        }
        disconnect(): void {
          disconnectCount += 1
        }
        unobserve(): void {}
      }
    )

    render(true, createElement('div'))
    expect(observeCount).toBe(1)

    render(true, createElement('div'), false, false)
    expect(disconnectCount).toBe(1)

    render(true, createElement('div'), false, true)
    expect(observeCount).toBe(2)
  })

  it('reports navigator width only when the width changes', () => {
    const onNavigatorWidthChange = vi.fn()
    const navigatorNode = createElement('div')
    act(() =>
      root.render(
        createElement(
          WorkspaceLayout,
          { navigator: navigatorNode, navigatorOpen: true, onNavigatorWidthChange },
          createElement('div')
        )
      )
    )
    expect(onNavigatorWidthChange).toHaveBeenCalledTimes(1)

    act(() =>
      root.render(
        createElement(
          WorkspaceLayout,
          {
            animating: true,
            navigator: navigatorNode,
            navigatorOpen: true,
            onNavigatorWidthChange
          },
          createElement('div')
        )
      )
    )

    expect(onNavigatorWidthChange).toHaveBeenCalledTimes(1)
    press(separator()!, 'ArrowLeft')
    expect(onNavigatorWidthChange).toHaveBeenCalledTimes(2)
    expect(onNavigatorWidthChange).toHaveBeenLastCalledWith(270)
  })

  it('ignores non-primary pointer buttons', () => {
    render(true, createElement('div'))
    const handle = separator()!
    handle.setPointerCapture = () => undefined

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', 300, 2)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 200)))

    expect(content().style.marginRight).toBe('260px')
    expect(container.querySelector('.workspace-layout')?.hasAttribute('data-resizing')).toBe(false)
  })

  it('stops resizing when the pointer interaction is cancelled', () => {
    render(true, createElement('div'))
    const handle = separator()!
    handle.setPointerCapture = () => undefined

    act(() => handle.dispatchEvent(pointerEvent('pointerdown', 300)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 250)))
    expect(content().style.marginRight).toBe('310px')

    act(() => handle.dispatchEvent(pointerEvent('pointercancel', 250)))
    act(() => handle.dispatchEvent(pointerEvent('pointermove', 200)))

    expect(content().style.marginRight).toBe('310px')
    expect(container.querySelector('.workspace-layout')?.hasAttribute('data-resizing')).toBe(false)
  })

  it('preserves navigator visibility while an inactive tab measures zero width', () => {
    const notifyResize = stubResizeObserver()
    render(true, createElement('div'))
    const body = container.querySelector<HTMLElement>('.workspace-layout-body')!

    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 700 })
    act(notifyResize)
    expect(content().style.marginRight).toBe('260px')

    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 0 })
    act(notifyResize)
    expect(content().style.marginRight).toBe('260px')
    expect(navigator()?.getAttribute('data-open')).toBe('true')
  })

  it('ignores intermediate widths during the outer workbench animation', () => {
    const notifyResize = stubResizeObserver()
    render(true, createElement('div'))
    const body = container.querySelector<HTMLElement>('.workspace-layout-body')!
    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 700 })
    act(notifyResize)

    render(true, createElement('div'), true)
    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 400 })
    act(notifyResize)

    expect(content().style.marginRight).toBe('260px')
    expect(navigator()?.getAttribute('data-open')).toBe('true')
  })

  it('hides the navigator when constrained and restores it when space returns', () => {
    const notifyResize = stubResizeObserver()
    render(true, createElement('div'))
    const body = container.querySelector<HTMLElement>('.workspace-layout-body')!

    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 400 })
    act(notifyResize)
    expect(content().style.marginRight).toBe('0px')
    expect(navigator()?.hasAttribute('data-open')).toBe(false)

    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 700 })
    act(notifyResize)
    expect(content().style.marginRight).toBe('260px')
    expect(navigator()?.getAttribute('data-open')).toBe('true')
  })

  it('shows the navigator only when its width and minimum content width fit', () => {
    const notifyResize = stubResizeObserver()
    render(true, createElement('div'))
    const body = container.querySelector<HTMLElement>('.workspace-layout-body')!

    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 539 })
    act(notifyResize)
    expect(navigator()?.hasAttribute('data-open')).toBe(false)

    Object.defineProperty(body, 'clientWidth', { configurable: true, value: 540 })
    act(notifyResize)
    expect(navigator()?.getAttribute('data-open')).toBe('true')
  })

  function render(
    navigatorOpen: boolean,
    navigator?: ReactNode,
    animating = false,
    visible = true
  ): void {
    act(() =>
      root.render(
        createElement(
          WorkspaceLayout,
          { animating, navigator, navigatorOpen, visible },
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

function stubResizeObserver(): () => void {
  let notify = (): void => undefined
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = () => callback([], this as unknown as ResizeObserver)
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
  )
  return () => notify()
}
