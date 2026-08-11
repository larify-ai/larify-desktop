// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionIds: string[] = []
const unmountedSessionIds: string[] = []
const headingChanges = new Map<string, (heading: { cwd: string; title: string } | null) => void>()
const savedCallbacks = new Map<string, () => void>()
let storedSession: { id: string; title: string; cwd: string } | undefined

vi.mock('../../../src/renderer/src/app/interaction/assistant/session', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react')
  return {
    AssistantSession: ({
      id,
      onHeadingChange,
      onSaved
    }: {
      id: string
      onHeadingChange: (heading: { cwd: string; title: string } | null) => void
      onSaved: () => void
    }) => {
      useEffect(() => {
        sessionIds.push(id)
        headingChanges.set(id, onHeadingChange)
        savedCallbacks.set(id, onSaved)
        return () => {
          headingChanges.delete(id)
          savedCallbacks.delete(id)
          unmountedSessionIds.push(id)
        }
      }, [id, onHeadingChange, onSaved])
      return null
    }
  }
})

vi.mock('allotment', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const MockAllotment = React.forwardRef(function MockAllotment(
    { children, id }: { children?: ReactNode; id?: string },
    ref
  ) {
    React.useImperativeHandle(ref, () => ({ reset: vi.fn(), resize: vi.fn() }))
    return createElement('div', { 'data-allotment': id }, children)
  }) as React.ForwardRefExoticComponent<
    { children?: ReactNode; id?: string } & React.RefAttributes<unknown>
  > & { Pane: (props: { children?: ReactNode; visible?: boolean }) => ReactNode }
  // Props are TypeScript-validated; this rule only understands runtime PropTypes.
  // eslint-disable-next-line react/prop-types
  MockAllotment.Pane = function MockPane({ children, visible = true }) {
    return visible ? createElement('div', {}, children) : null
  }
  return { Allotment: MockAllotment }
})

import { Layout } from '../../../src/renderer/src/app/layout/layout'
import { TooltipProvider } from '../../../src/renderer/src/components/ui/tooltip'
import { Registry } from '../../../src/shared/infra/registry'
import { RendererRegistryProvider } from '../../../src/renderer/src/app/registry/renderer-registry-provider'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../src/renderer/src/app/registry/workbench-renderers'

describe('layout panel behavior', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    sessionIds.length = 0
    unmountedSessionIds.length = 0
    headingChanges.clear()
    savedCallbacks.clear()
    storedSession = undefined
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: {
        on: vi.fn(() => vi.fn()),
        invoke: vi.fn((channel: string) => {
          if (!storedSession) return Promise.resolve([])
          if (channel === 'session:cwds') return Promise.resolve([storedSession.cwd])
          if (channel === 'session:list') return Promise.resolve([storedSession])
          return Promise.resolve([])
        })
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const registry = new Registry()
    registry.register(workbenchRendererRegistryToken, new WorkbenchRendererRegistry(registry))
    await act(async () =>
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(TooltipProvider, null, createElement(Layout))
        )
      )
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'bridge')
    vi.unstubAllGlobals()
  })

  it('restores the workbench layout after toggling twice', async () => {
    expect(container.querySelector('[aria-label="Workbench"]')).toBeNull()

    await click('显示工作台')
    expect(container.querySelector('[aria-label="Workbench"]')).not.toBeNull()

    await click('隐藏工作台')
    expect(container.querySelector('[aria-label="Workbench"]')).toBeNull()
  })

  it('collapses and restores navigation', async () => {
    expect(container.querySelector('[aria-label="Navigation"]')).not.toBeNull()

    await click('隐藏侧边栏')
    expect(container.querySelector('[aria-label="Navigation"]')).toBeNull()

    await click('显示侧边栏')
    expect(container.querySelector('[aria-label="Navigation"]')).not.toBeNull()
  })

  it('creates a task record only after the draft is sent', async () => {
    const initial = sessionIds[0]

    await click('新建任务')
    expect(sessionIds).toHaveLength(1)

    await act(async () => headingChanges.get(initial)?.({ cwd: '', title: '第一个任务' }))
    storedSession = { id: initial, cwd: '', title: '第一个任务' }
    await act(async () => savedCallbacks.get(initial)?.())
    await click('新建任务')

    expect(sessionIds).toHaveLength(2)
    expect(sessionIds[1]).not.toBe(initial)
    expect(unmountedSessionIds).not.toContain(initial)

    const taskButtons = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => button.textContent === '第一个任务'
    )
    expect(taskButtons).toHaveLength(1)
    await act(async () => taskButtons[0].click())
    expect(taskButtons[0].ariaCurrent).toBe('page')
    expect(unmountedSessionIds).not.toContain(initial)
  })

  async function click(label: string): Promise<void> {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.ariaLabel === label || button.textContent === label
    )
    expect(button).not.toBeNull()
    await act(async () => button?.click())
  }
})
