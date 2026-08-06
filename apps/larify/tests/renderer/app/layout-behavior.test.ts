// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Layout = Record<string, number>

const layouts = new Map<string, Layout>()

vi.mock('../../../src/renderer/src/components/ui/resizable', () => ({
  ResizablePanelGroup: ({
    children,
    groupRef,
    id
  }: {
    children?: ReactNode
    groupRef?: { current: unknown }
    id: string
  }) => {
    const initial =
      id === 'main' ? { navigation: 15, content: 85 } : { interaction: 64, workbench: 36 }
    layouts.set(id, layouts.get(id) ?? initial)
    if (groupRef) {
      groupRef.current = {
        getLayout: () => layouts.get(id) ?? {},
        setLayout: (layout: Layout) => layouts.set(id, layout)
      }
    }
    return createElement('div', {}, children)
  },
  ResizablePanel: ({ children }: { children?: ReactNode }) => createElement('div', {}, children),
  ResizableHandle: () => createElement('div')
}))

vi.mock('react-resizable-panels', async () => {
  const { useRef } = await vi.importActual<typeof import('react')>('react')
  return { useGroupRef: () => useRef(null) }
})

import { Layout } from '../../../src/renderer/src/app/layout/layout'

describe('layout panel behavior', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    layouts.clear()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(Layout)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('restores the workbench layout after toggling twice', async () => {
    expect(layouts.get('content')).toEqual({ interaction: 100, workbench: 0 })

    await click('切换工作区')
    expect(layouts.get('content')).toEqual({ interaction: 64, workbench: 36 })

    await click('切换工作区')
    expect(layouts.get('content')).toEqual({ interaction: 100, workbench: 0 })
  })

  it('preserves a resized navigation layout across collapse and expand', async () => {
    layouts.set('main', { navigation: 20, content: 80 })

    await click('切换侧边栏')
    expect(layouts.get('main')).toEqual({ navigation: 0, content: 100 })

    await click('切换侧边栏')
    expect(layouts.get('main')).toEqual({ navigation: 20, content: 80 })
  })

  async function click(label: string): Promise<void> {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    expect(button).not.toBeNull()
    await act(async () => button?.click())
  }
})
