// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkbenchTabs,
  type WorkbenchTab
} from '../../../../src/renderer/src/app/workbench/workbench-tabs'
import { resolveTabCloseTargets } from '../../../../src/renderer/src/app/workbench/tab-close-actions'
import { resolveTabReorder } from '../../../../src/renderer/src/app/workbench/tab-reorder'

const icon = createElement('span', { 'data-testid': 'tab-icon' })
const tabs: WorkbenchTab[] = [
  { id: 'terminal:1', icon, title: 'Terminal' },
  { id: 'browser:1', icon, title: 'Browser' }
]

describe('WorkbenchTabs', () => {
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
    vi.restoreAllMocks()
  })

  const renderTabs = async ({
    activeId = 'terminal:1',
    onClose = vi.fn(),
    onHome = vi.fn(),
    onReorder = vi.fn(),
    onSelect = vi.fn(),
    value = tabs
  }: {
    activeId?: string | null
    onClose?: (id: string) => void
    onHome?: () => void
    onReorder?: (id: string, fromIndex: number, toIndex: number) => void
    onSelect?: (id: string) => void
    value?: WorkbenchTab[]
  } = {}): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(WorkbenchTabs, {
          activeId,
          tabs: value,
          onClose,
          onHome,
          onReorder,
          onSelect
        })
      )
    })
  }

  it('renders controlled tabs and forwards select, close, and home actions', async () => {
    const onClose = vi.fn()
    const onHome = vi.fn()
    const onSelect = vi.fn()
    await renderTabs({ onClose, onHome, onSelect })

    expect(
      container.querySelector('.larify-workbench-tabs')?.getAttribute('data-theme-source')
    ).toBe('workbench')
    expect(
      container
        .querySelector('[data-tab-id="terminal:1"] .larify-workbench-tab-trigger')
        ?.getAttribute('data-state')
    ).toBe('active')
    expect(container.querySelectorAll('[data-testid="tab-icon"]')).toHaveLength(2)
    expect(
      container
        .querySelector('[data-tab-id="terminal:1"] .larify-workbench-tab-close')
        ?.getAttribute('title')
    ).toBe('关闭标签页')

    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-tab-id="browser:1"] .larify-workbench-tab-trigger')
        ?.dispatchEvent(mouseDown())
      container
        .querySelector<HTMLButtonElement>('[data-tab-id="terminal:1"] .larify-workbench-tab-close')
        ?.click()
      container.querySelector<HTMLButtonElement>('.larify-workbench-home')?.click()
    })

    expect(onSelect).toHaveBeenCalledWith('browser:1')
    expect(onClose).toHaveBeenCalledWith('terminal:1')
    expect(onHome).toHaveBeenCalledOnce()
  })

  it('keeps the active tab controlled without an overflow menu', async () => {
    await renderTabs({ activeId: 'terminal:1' })
    await renderTabs({ activeId: 'browser:1' })

    expect(container.querySelector('.larify-workbench-tab-scroll')).not.toBeNull()
    expect(container.querySelector('[aria-haspopup="listbox"]')).toBeNull()
    expect(
      container
        .querySelector('[data-tab-id="browser:1"] .larify-workbench-tab-trigger')
        ?.getAttribute('data-state')
    ).toBe('active')
  })

  it('selects the adjacent tab with Radix keyboard navigation', async () => {
    const onSelect = vi.fn()
    await renderTabs({ onSelect })
    const activeTab = container.querySelector<HTMLElement>(
      '[data-tab-id="terminal:1"] [role="tab"]'
    )!

    await act(async () => {
      activeTab.focus()
      activeTab.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, code: 'ArrowRight', key: 'ArrowRight' })
      )
    })

    expect(onSelect).toHaveBeenCalledWith('browser:1')
  })

  it('scrolls a newly active tab into view', async () => {
    await renderTabs({ activeId: 'terminal:1' })
    const scroller = container.querySelector<HTMLElement>('.larify-workbench-tab-scroll')!
    const browserTab = container.querySelector<HTMLElement>('[data-tab-id="browser:1"]')!
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 0, writable: true }
    })
    Object.defineProperties(browserTab, {
      offsetLeft: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 100 }
    })
    await renderTabs({ activeId: 'browser:1' })

    expect(scroller.scrollLeft).toBe(200)
  })

  it('recalculates overflow when tab content changes without changing the tab count', async () => {
    await renderTabs()
    const scroller = container.querySelector<HTMLElement>('.larify-workbench-tab-scroll')!
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 500 }
    })

    await renderTabs({ value: tabs.map((tab) => ({ ...tab, title: `${tab.title} expanded` })) })

    expect(scroller.getAttribute('data-scroll-edges')).toBe('right')
  })

  it('keeps the active tab visible when another tab changes width', async () => {
    await renderTabs({ activeId: 'browser:1' })
    const scroller = container.querySelector<HTMLElement>('.larify-workbench-tab-scroll')!
    const browserTab = container.querySelector<HTMLElement>('[data-tab-id="browser:1"]')!
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 0, writable: true }
    })
    Object.defineProperties(browserTab, {
      offsetLeft: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 100 }
    })

    await renderTabs({
      activeId: 'browser:1',
      value: tabs.map((tab) => ({ ...tab, title: `${tab.title} expanded` }))
    })

    expect(scroller.scrollLeft).toBe(200)
  })

  it('observes both the viewport and tab list for layout changes', async () => {
    const observers: Array<{
      disconnect: ReturnType<typeof vi.fn>
      observe: ReturnType<typeof vi.fn>
    }> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()

        constructor() {
          observers.push(this)
        }
      }
    )
    await renderTabs()

    const scroller = container.querySelector('.larify-workbench-tab-scroll')
    const list = container.querySelector('.larify-workbench-tab-list')
    const observer = observers.find(
      ({ observe }) =>
        observe.mock.calls.some(([element]) => element === scroller) &&
        observe.mock.calls.some(([element]) => element === list)
    )
    expect(observer).toBeDefined()

    act(() => root.unmount())
    expect(observer?.disconnect).toHaveBeenCalledOnce()
    root = createRoot(container)
    vi.unstubAllGlobals()
  })

  it('converts the mouse wheel to horizontal scrolling when tabs overflow', async () => {
    await renderTabs()
    const scroller = container.querySelector<HTMLElement>('.larify-workbench-tab-scroll')!
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 500 }
    })

    await act(async () => {
      scroller.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 64 })
      )
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    expect(scroller.scrollLeft).toBe(64)
    expect(scroller.getAttribute('data-scroll-edges')).toBe('left right')

    await act(async () => {
      scroller.scrollLeft = 300
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(scroller.getAttribute('data-scroll-edges')).toBe('left')
  })

  it('offers close-others and close-right actions', async () => {
    const onClose = vi.fn()
    await renderTabs({ onClose })
    const tab = container.querySelector<HTMLElement>('[data-tab-id="terminal:1"]')!
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(120, 160))

    await act(async () => {
      tab.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          button: 2,
          cancelable: true,
          clientX: 150
        })
      )
    })

    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map((item) => item.textContent)).toEqual(['关闭其他标签页', '关闭右侧标签页'])
    const menu = document.querySelector<HTMLElement>('.larify-workbench-tab-menu')
    expect(menu?.style.width).toBe('160px')
    expect(menu?.dataset.side).toBe('bottom')

    await act(async () => items[1].click())
    expect(onClose).toHaveBeenCalledWith('browser:1')
  })

  it('returns focus to the tab after dismissing its context menu', async () => {
    await renderTabs()
    const tab = container.querySelector<HTMLElement>('[data-tab-id="terminal:1"]')!
    const trigger = tab.querySelector<HTMLElement>('.larify-workbench-tab-trigger')!
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(120, 160))

    await act(async () => {
      trigger.focus()
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }))
    })
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(document.activeElement).toBe(menu)

    await act(async () => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })

    expect(document.activeElement).toBe(trigger)
  })

  it('keeps the home action visible and active with no tabs', async () => {
    await renderTabs({ activeId: null, value: [] })
    expect(container.querySelector('.larify-workbench-home')?.hasAttribute('data-active')).toBe(
      true
    )
  })

  it('reorders tabs through the pointer sensor without selecting the dragged tab', async () => {
    const onReorder = vi.fn()
    const onSelect = vi.fn()
    await renderTabs({ onReorder, onSelect })
    const first = container.querySelector<HTMLElement>('[data-tab-id="terminal:1"]')!
    const second = container.querySelector<HTMLElement>('[data-tab-id="browser:1"]')!
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(rect(100, 100))

    await act(async () => first.dispatchEvent(pointer('pointerdown', 20)))
    await act(async () => document.dispatchEvent(pointer('pointermove', 30)))
    await act(async () => document.dispatchEvent(pointer('pointermove', 160)))
    await act(async () => {
      document.dispatchEvent(pointer('pointerup', 160))
      first.querySelector<HTMLElement>('.larify-workbench-tab-trigger')?.click()
    })

    expect(onReorder).toHaveBeenCalledWith('terminal:1', 0, 1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('resolveTabReorder', () => {
  it('maps dnd-kit active and over ids to the public reorder callback', () => {
    expect(resolveTabReorder(tabs, 'terminal:1', 'browser:1')).toEqual({
      id: 'terminal:1',
      fromIndex: 0,
      toIndex: 1
    })
    expect(resolveTabReorder(tabs, 'browser:1', 'terminal:1')).toEqual({
      id: 'browser:1',
      fromIndex: 1,
      toIndex: 0
    })
  })

  it('ignores cancelled, unchanged, and stale drops', () => {
    const ids = tabs.map(({ id }) => id)

    expect(resolveTabReorder(tabs, 'terminal:1', null)).toBeNull()
    expect(resolveTabReorder(tabs, 'terminal:1', 'terminal:1')).toBeNull()
    expect(resolveTabReorder(tabs, 'missing', 'browser:1')).toBeNull()
    expect(resolveTabReorder(tabs, 'terminal:1', 'missing')).toBeNull()
    expect(tabs.map(({ id }) => id)).toEqual(ids)
  })
})

describe('resolveTabCloseTargets', () => {
  it('resolves current, other, and right-side tabs', () => {
    expect(resolveTabCloseTargets(tabs, 'terminal:1', 'current')).toEqual(['terminal:1'])
    expect(resolveTabCloseTargets(tabs, 'terminal:1', 'others')).toEqual(['browser:1'])
    expect(resolveTabCloseTargets(tabs, 'terminal:1', 'right')).toEqual(['browser:1'])
    expect(resolveTabCloseTargets(tabs, 'browser:1', 'right')).toEqual([])
  })

  it('ignores a stale target without changing the input order', () => {
    const ids = tabs.map(({ id }) => id)

    expect(resolveTabCloseTargets(tabs, 'missing', 'current')).toEqual([])
    expect(resolveTabCloseTargets(tabs, 'missing', 'others')).toEqual([])
    expect(resolveTabCloseTargets(tabs, 'missing', 'right')).toEqual([])
    expect(tabs.map(({ id }) => id)).toEqual(ids)
  })
})

function pointer(type: string, clientX: number): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX })
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' }
  })
  return event
}

function mouseDown(): MouseEvent {
  return new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true })
}

function rect(left: number, width: number): DOMRect {
  return {
    bottom: 36,
    height: 36,
    left,
    right: left + width,
    top: 0,
    width,
    x: left,
    y: 0,
    toJSON: () => ({})
  }
}
