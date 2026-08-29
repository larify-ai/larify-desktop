// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ConversationNavigationRail,
  type ConversationNavigationEntry
} from '../../../../../src/renderer/src/app/interaction/assistant/conversation-navigation-rail'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const entries: ConversationNavigationEntry[] = [
  { id: 'one', index: 10, summary: 'First request', response: 'First response' },
  { id: 'two', index: 20, summary: 'Second request', response: 'Second response' },
  { id: 'three', index: 30, summary: 'Third request' }
]

describe('ConversationNavigationRail', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await act(async () => root.unmount())
    container.remove()
    document.body.replaceChildren()
  })

  it('does not crash when a current index is supplied before entries load', async () => {
    await act(async () =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries: [],
          currentIndex: 0,
          onNavigate: vi.fn()
        })
      )
    )

    expect(container.textContent).toBe('')
  })

  it('selects the closest entry and navigates once on click', async () => {
    const onNavigate = vi.fn()
    await act(async () =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries,
          currentIndex: 18,
          onNavigate
        })
      )
    )

    const buttons = container.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[1].getAttribute('aria-current')).toBe('true')

    await act(async () => buttons[0].click())
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith(entries[0], 'smooth')
  })

  it('navigates when the click lands in the rail gap instead of a marker button', async () => {
    const onNavigate = vi.fn()
    await act(async () =>
      root.render(createElement(ConversationNavigationRail, { entries, onNavigate }))
    )

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 64 }) as DOMRect
    rail.scrollTop = 0
    await act(async () =>
      rail.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 15 }))
    )

    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith(entries[1], 'smooth')
  })

  it('persists bookmarks and requests older navigation entries near the top', async () => {
    const onLoadOlder = vi.fn()
    const persist = vi.spyOn(Storage.prototype, 'setItem')
    await act(async () =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries,
          onNavigate: vi.fn(),
          onLoadOlder
        })
      )
    )
    expect(persist).not.toHaveBeenCalled()

    const first = container.querySelector<HTMLButtonElement>('button')!
    await act(async () => first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(persist).toHaveBeenCalledOnce()
    expect(JSON.parse(localStorage.getItem('larify:conversation-navigation-bookmarks')!)).toEqual([
      'one'
    ])
    await act(async () => first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(persist).toHaveBeenCalledTimes(2)
    expect(JSON.parse(localStorage.getItem('larify:conversation-navigation-bookmarks')!)).toEqual(
      []
    )

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.scrollTop = 0
    await act(async () => {
      rail.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }))
    })
    expect(onLoadOlder).toHaveBeenCalledOnce()

    await act(async () =>
      rail.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
    )
    expect(onLoadOlder).toHaveBeenCalledOnce()

    await act(async () =>
      rail.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }))
    )
    await act(async () =>
      rail.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
    )
    expect(onLoadOlder).toHaveBeenCalledTimes(2)
  })

  it('does not start a drag or navigate for a secondary-button pointer gesture', async () => {
    const onNavigate = vi.fn()
    await act(async () =>
      root.render(createElement(ConversationNavigationRail, { entries, onNavigate }))
    )

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 64 }) as DOMRect
    rail.setPointerCapture = vi.fn()
    rail.releasePointerCapture = vi.fn()
    await act(async () => {
      rail.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2, clientY: 5 }))
      rail.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 2, clientY: 25 }))
      rail.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 2, clientY: 25 }))
    })

    expect(rail.setPointerCapture).not.toHaveBeenCalled()
    expect(rail.releasePointerCapture).not.toHaveBeenCalled()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('shows the request and response after the hover delay', async () => {
    vi.useFakeTimers()
    await act(async () =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries,
          onNavigate: vi.fn()
        })
      )
    )

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 64 }) as DOMRect
    rail.scrollTop = 0
    await act(async () => {
      rail.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientY: 15 }))
      vi.advanceTimersByTime(150)
    })

    expect(document.body.textContent).toContain('Second request')
    expect(document.body.textContent).toContain('Second response')
    expect(
      [...document.body.querySelectorAll('div')]
        .find((element) => element.textContent === 'Second response')
        ?.classList.contains('whitespace-normal')
    ).toBe(true)
  })

  it('refreshes the hover preview when the rail scrolls beneath the pointer', async () => {
    vi.useFakeTimers()
    await act(async () =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries,
          onNavigate: vi.fn()
        })
      )
    )

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 20 }) as DOMRect
    rail.scrollTop = 0
    await act(async () => {
      rail.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientY: 5 }))
      vi.advanceTimersByTime(150)
    })
    expect(document.body.textContent).toContain('First request')

    rail.scrollTop = 10
    await act(async () => rail.dispatchEvent(new UIEvent('scroll')))
    expect(document.body.textContent).toContain('Second request')
    expect(document.body.textContent).not.toContain('First request')
  })

  it('navigates once with auto behavior after a drag and suppresses its synthetic click', async () => {
    vi.useFakeTimers()
    const onNavigate = vi.fn()
    await act(async () =>
      root.render(createElement(ConversationNavigationRail, { entries, onNavigate }))
    )

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 64 }) as DOMRect
    rail.scrollTop = 0
    rail.setPointerCapture = vi.fn()
    rail.releasePointerCapture = vi.fn()

    await act(async () => {
      rail.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 5 }))
      rail.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 25 }))
      rail.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 25 }))
      container
        .querySelectorAll<HTMLButtonElement>('button')[2]
        .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    })

    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith(entries[2], 'auto')
  })

  it('loads the next navigation page when a non-scrollable rail is dragged to its top', async () => {
    const onLoadOlder = vi.fn()
    await act(async () =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries,
          onNavigate: vi.fn(),
          onLoadOlder
        })
      )
    )

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 30 }) as DOMRect
    rail.scrollTop = 0
    rail.setPointerCapture = vi.fn()
    rail.releasePointerCapture = vi.fn()
    await act(async () => {
      rail.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 25 }))
      rail.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 5 }))
      rail.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 5 }))
    })

    expect(onLoadOlder).toHaveBeenCalledOnce()
  })

  it('keeps the rail position stable when older entries are prepended', async () => {
    const initialEntries = entries.slice(1)
    await act(async () =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries: initialEntries,
          currentIndex: 30,
          onNavigate: vi.fn()
        })
      )
    )

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    Object.defineProperty(rail, 'clientHeight', { configurable: true, value: 20 })
    rail.scrollTop = 5

    await act(async () =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries,
          currentIndex: 30,
          onNavigate: vi.fn()
        })
      )
    )

    expect(rail.scrollTop).toBe(15)
  })

  it('refreshes an open hover preview when entry metadata changes', async () => {
    vi.useFakeTimers()
    const render = (nextEntries: ConversationNavigationEntry[]): void =>
      root.render(
        createElement(ConversationNavigationRail, {
          entries: nextEntries,
          onNavigate: vi.fn()
        })
      )
    await act(async () => render(entries))

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 64 }) as DOMRect
    rail.scrollTop = 0
    await act(async () => {
      rail.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientY: 5 }))
      vi.advanceTimersByTime(150)
    })
    await act(async () =>
      render(
        entries.map((entry) => (entry.id === 'one' ? { ...entry, response: 'Updated' } : entry))
      )
    )

    expect(document.body.textContent).toContain('Updated')
    expect(document.body.textContent).not.toContain('First response')

    await act(async () => render(entries.slice(1)))
    expect(document.body.textContent).not.toContain('First request')
  })
})
