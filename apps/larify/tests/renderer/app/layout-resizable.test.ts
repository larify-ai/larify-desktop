// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/src/app/interaction/interaction', () => ({
  Interaction: () => createElement('div', { 'data-region': 'interaction' })
}))

vi.mock('../../../src/renderer/src/app/navigation/navigation', () => ({
  Navigation: ({ onCollapse, showToggle }: { onCollapse: () => void; showToggle?: boolean }) =>
    showToggle ? createElement('button', { 'aria-label': '隐藏侧边栏', onClick: onCollapse }) : null
}))

vi.mock('../../../src/renderer/src/app/workbench/workbench', () => ({
  WorkbenchHost: () => createElement('div', { 'data-region': 'workbench' })
}))

vi.mock('../../../src/renderer/src/app/interaction/assistant/sessions-context', () => ({
  useAssistantSessions: () => ({ activeSession: { heading: null } })
}))

import { LayoutPanels } from '../../../src/renderer/src/app/layout/layout-panels'

describe('layout with the real resizable component', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
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

  it('uses nested Allotment split views with workbench feedback styling', () => {
    expect(container.querySelectorAll('.larify-allotment')).toHaveLength(2)
    expect(container.querySelector('.larify-workbench-allotment')).not.toBeNull()
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
})
