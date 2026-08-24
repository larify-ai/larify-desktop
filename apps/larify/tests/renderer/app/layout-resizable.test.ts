// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const renderSpies = vi.hoisted(() => ({ interaction: vi.fn(), workbench: vi.fn() }))

vi.mock('../../../src/renderer/src/app/interaction/interaction', () => ({
  Interaction: () => {
    renderSpies.interaction()
    return createElement('div', { 'data-region': 'interaction' })
  }
}))

vi.mock('../../../src/renderer/src/app/navigation/navigation', () => ({
  Navigation: ({ onCollapse, showToggle }: { onCollapse: () => void; showToggle?: boolean }) =>
    showToggle ? createElement('button', { 'aria-label': '隐藏侧边栏', onClick: onCollapse }) : null
}))

vi.mock('../../../src/renderer/src/app/workbench/workbench', () => ({
  WorkbenchHost: () => {
    renderSpies.workbench()
    return createElement('div', { 'data-region': 'workbench' })
  }
}))

vi.mock('../../../src/renderer/src/app/interaction/assistant/sessions-context', () => ({
  useAssistantSessions: () => ({ activeSession: { heading: null } })
}))

import { LayoutPanels } from '../../../src/renderer/src/app/layout/layout-panels'

describe('layout with the real resizable component', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    renderSpies.interaction.mockClear()
    renderSpies.workbench.mockClear()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    HTMLElement.prototype.setPointerCapture = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(LayoutPanels)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('shows the matching navigation toggle after each state change', async () => {
    expect(buttons('隐藏侧边栏')).toHaveLength(1)
    expect(buttons('显示侧边栏')).toHaveLength(0)

    await click('隐藏侧边栏')
    expect(buttons('隐藏侧边栏')).toHaveLength(0)
    expect(buttons('显示侧边栏')).toHaveLength(1)

    await click('显示侧边栏')
    expect(buttons('显示侧边栏')).toHaveLength(0)
  })

  it('toggles the initially collapsed workbench with one button', async () => {
    expect(buttons('显示工作台')).toHaveLength(1)
    expect(buttons('隐藏工作台')).toHaveLength(0)

    await click('显示工作台')
    expect(buttons('显示工作台')).toHaveLength(0)
    expect(buttons('隐藏工作台')).toHaveLength(1)

    await click('隐藏工作台')
    expect(buttons('显示工作台')).toHaveLength(1)
    expect(buttons('隐藏工作台')).toHaveLength(0)
  })

  it('expands the workbench when a conversation card opens a tool', async () => {
    expect(buttons('显示工作台')).toHaveLength(1)

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-open', {
          detail: { rendererId: 'changes' }
        })
      )
    })

    expect(buttons('显示工作台')).toHaveLength(0)
    expect(buttons('隐藏工作台')).toHaveLength(1)
  })

  it('keeps the workbench open when multiple open requests arrive', async () => {
    await act(async () => {
      const detail = { rendererId: 'changes' }
      window.dispatchEvent(new CustomEvent('larify:workbench-open', { detail }))
      window.dispatchEvent(new CustomEvent('larify:workbench-open', { detail }))
    })

    expect(buttons('显示工作台')).toHaveLength(0)
    expect(buttons('隐藏工作台')).toHaveLength(1)

    const states: Array<{ animating: boolean; visible: boolean }> = []
    const receiveState = (event: Event): void => {
      states.push((event as CustomEvent<{ animating: boolean; visible: boolean }>).detail)
    }
    window.addEventListener('larify:workbench-animation', receiveState)
    window.dispatchEvent(new Event('larify:workbench-state-request'))
    window.removeEventListener('larify:workbench-animation', receiveState)

    expect(states.at(-1)).toEqual({ animating: false, visible: true })
  })

  it('uses Allotment only for navigation and a lightweight workbench split', () => {
    expect(container.querySelectorAll('.larify-allotment')).toHaveLength(1)
    expect(container.querySelector('.larify-workbench-split')).not.toBeNull()
  })

  it('does not rerender pane contents while toggling layout panels', async () => {
    expect(renderSpies.interaction).toHaveBeenCalledTimes(1)
    expect(renderSpies.workbench).toHaveBeenCalledTimes(1)

    await click('隐藏侧边栏')
    await click('显示侧边栏')
    await click('显示工作台')
    await click('隐藏工作台')

    expect(renderSpies.interaction).toHaveBeenCalledTimes(1)
    expect(renderSpies.workbench).toHaveBeenCalledTimes(1)
  })

  it('reports the current workbench animation state on request', () => {
    const states: Array<{ animating: boolean; visible: boolean }> = []
    const receiveState = (event: Event): void => {
      states.push((event as CustomEvent<{ animating: boolean; visible: boolean }>).detail)
    }
    window.addEventListener('larify:workbench-animation', receiveState)

    window.dispatchEvent(new Event('larify:workbench-state-request'))

    expect(states).toEqual([{ animating: false, visible: false }])
    window.removeEventListener('larify:workbench-animation', receiveState)
  })

  it('keeps pane content at its minimum width while the outer pane collapses', () => {
    const navigation = container.querySelector<HTMLElement>(
      '.larify-allotment > .split-view-container > .split-view-view'
    )?.firstElementChild as HTMLElement | undefined
    const workbench = container.querySelector<HTMLElement>(
      '[data-region="workbench"]'
    )?.parentElement

    expect(navigation?.style.minWidth).toBe('180px')
    expect(workbench?.style.minWidth).toBe('280px')
  })

  it('shows an accessible resize handle only while the workbench is open', async () => {
    expect(container.querySelector('[role="separator"]')).toBeNull()

    await click('显示工作台')

    const handle = container.querySelector<HTMLElement>('[role="separator"]')
    expect(handle?.getAttribute('aria-label')).toBe('调整工作台宽度')
    expect(handle?.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle?.getAttribute('aria-valuemin')).toBe('280')
    expect(handle?.parentElement?.classList.contains('larify-interaction-pane')).toBe(true)
    expect(handle?.closest('.larify-workbench-pane')).toBeNull()
  })

  it('keeps both panes laid out at the live pointer width', async () => {
    await click('显示工作台')

    const split = container.querySelector<HTMLElement>('.larify-workbench-split')
    const pane = container.querySelector<HTMLElement>('.larify-workbench-pane')
    const handle = container.querySelector<HTMLElement>('[role="separator"]')
    expect(split).not.toBeNull()
    expect(pane?.style.width).toBe('700px')
    expect(handle).not.toBeNull()

    Object.defineProperty(split, 'clientWidth', { configurable: true, value: 1200 })
    pane!.getBoundingClientRect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 700,
      top: 0,
      width: 700,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })

    await act(async () => {
      handle!.dispatchEvent(pointerEvent('pointerdown', 1000))
      window.dispatchEvent(pointerEvent('pointermove', 900))
    })

    expect(split?.getAttribute('data-resizing')).toBe('true')
    expect(pane?.style.width).toBe('800px')

    await act(async () => window.dispatchEvent(pointerEvent('pointerup', 900)))

    expect(split?.hasAttribute('data-resizing')).toBe(false)
    expect(pane?.style.width).toBe('800px')
  })

  it('ignores non-primary pointer drags', async () => {
    await click('显示工作台')

    const split = container.querySelector<HTMLElement>('.larify-workbench-split')!
    const pane = container.querySelector<HTMLElement>('.larify-workbench-pane')!
    const handle = container.querySelector<HTMLElement>('[role="separator"]')!
    Object.defineProperty(split, 'clientWidth', { configurable: true, value: 1200 })

    await act(async () => {
      handle.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 1, clientX: 1000 })
      )
      window.dispatchEvent(pointerEvent('pointermove', 800))
    })

    expect(split.hasAttribute('data-resizing')).toBe(false)
    expect(pane.style.width).toBe('700px')
    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled()
  })

  it('commits the latest width when the pointer is cancelled', async () => {
    await click('显示工作台')

    const split = container.querySelector<HTMLElement>('.larify-workbench-split')!
    const pane = container.querySelector<HTMLElement>('.larify-workbench-pane')!
    const handle = container.querySelector<HTMLElement>('[role="separator"]')!
    Object.defineProperty(split, 'clientWidth', { configurable: true, value: 1200 })
    pane.getBoundingClientRect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 700,
      top: 0,
      width: 700,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })

    await act(async () => {
      handle.dispatchEvent(pointerEvent('pointerdown', 1000))
      window.dispatchEvent(pointerEvent('pointermove', 850))
      window.dispatchEvent(pointerEvent('pointercancel', 850))
    })

    expect(split.hasAttribute('data-resizing')).toBe(false)
    expect(pane.style.width).toBe('850px')

    await act(async () => window.dispatchEvent(pointerEvent('pointermove', 700)))
    expect(pane.style.width).toBe('850px')
  })

  it('clamps keyboard resizing to both pane minimums', async () => {
    await click('显示工作台')

    const split = container.querySelector<HTMLElement>('.larify-workbench-split')!
    const pane = container.querySelector<HTMLElement>('.larify-workbench-pane')!
    const handle = container.querySelector<HTMLElement>('[role="separator"]')!
    Object.defineProperty(split, 'clientWidth', { configurable: true, value: 1000 })

    await act(async () => {
      for (let index = 0; index < 100; index += 1) {
        handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))
      }
    })
    expect(pane.style.width).toBe('664px')

    await act(async () => {
      for (let index = 0; index < 100; index += 1) {
        handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
      }
    })
    expect(pane.style.width).toBe('280px')
  })

  it('cancels an active resize when the workbench collapses', async () => {
    await click('显示工作台')

    const split = container.querySelector<HTMLElement>('.larify-workbench-split')!
    const pane = container.querySelector<HTMLElement>('.larify-workbench-pane')!
    const handle = container.querySelector<HTMLElement>('[role="separator"]')!
    Object.defineProperty(split, 'clientWidth', { configurable: true, value: 1200 })
    pane.getBoundingClientRect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 700,
      top: 0,
      width: 700,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    const phases: string[] = []
    const recordPhase = (event: Event): void => {
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase
      if (phase) phases.push(phase)
    }
    window.addEventListener('larify:native-layout', recordPhase)

    await act(async () => handle.dispatchEvent(pointerEvent('pointerdown', 1000)))
    expect(split.getAttribute('data-resizing')).toBe('true')

    await click('隐藏工作台')
    expect(split.hasAttribute('data-resizing')).toBe(false)

    await act(async () => window.dispatchEvent(pointerEvent('pointermove', 800)))
    await click('显示工作台')
    expect(pane.style.width).toBe('700px')
    expect(phases).toEqual(['start', 'end'])
    window.removeEventListener('larify:native-layout', recordPhase)
  })

  it('synchronizes native view bounds in the same frame as each pointer width', async () => {
    await click('显示工作台')
    const split = container.querySelector<HTMLElement>('.larify-workbench-split')!
    const pane = container.querySelector<HTMLElement>('.larify-workbench-pane')!
    const handle = container.querySelector<HTMLElement>('[role="separator"]')!
    Object.defineProperty(split, 'clientWidth', { configurable: true, value: 1200 })
    pane.getBoundingClientRect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 700,
      top: 0,
      width: 700,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    const nativeLayouts = vi.fn()
    window.addEventListener('larify:native-layout', nativeLayouts)

    await act(async () => {
      handle.dispatchEvent(pointerEvent('pointerdown', 1000))
      window.dispatchEvent(pointerEvent('pointermove', 900))
    })

    expect(pane.style.width).toBe('800px')
    expect(nativeLayouts).toHaveBeenCalledTimes(2)

    await act(async () => window.dispatchEvent(pointerEvent('pointerup', 900)))
    window.removeEventListener('larify:native-layout', nativeLayouts)
  })

  it('clips navigation content when its panel collapses', () => {
    expect(container.querySelectorAll('.overflow-hidden')).not.toHaveLength(0)
  })

  function buttons(label: string): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]
  }

  async function click(label: string): Promise<void> {
    const button = buttons(label)[0]
    expect(button).toBeDefined()
    await act(async () => button.click())
  }

  function pointerEvent(type: string, clientX: number): MouseEvent {
    return new MouseEvent(type, { bubbles: true, button: 0, clientX })
  }
})
