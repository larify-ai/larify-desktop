// @vitest-environment jsdom

import { act, createElement, useEffect, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from '../../../../src/shared/infra/disposable'
import { Registry } from '../../../../src/shared/infra/registry'
import { RendererRegistryProvider } from '../../../../src/renderer/src/app/registry/renderer-registry-provider'
import { createWorkbenchStore } from '../../../../src/renderer/src/app/workbench/workbench-store'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'
import { WorkbenchShell } from '../../../../src/renderer/src/app/workbench/workbench-shell'
import { useWorkbenchTabActions } from '../../../../src/renderer/src/app/workbench/workbench-tab-actions'

describe('WorkbenchShell', () => {
  let container: HTMLDivElement
  let invoke: ReturnType<typeof vi.fn>
  let registry: Registry
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    invoke = vi.fn().mockResolvedValue(undefined)
    Object.assign(window, { bridge: { invoke } })
    registry = new Registry()
    registry.register(workbenchRendererRegistryToken, new WorkbenchRendererRegistry(registry))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('connects store views, tabs, and the active renderer', async () => {
    const store = createWorkbenchStore()
    const first = store.getState().openView({ rendererId: 'terminal', resourceId: 1 })
    const second = store.getState().openView({ rendererId: 'browser', resourceId: 2 })

    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, {
            onOpenTool: vi.fn(),
            store
          })
        )
      )
    })
    expect(
      container.querySelector('[data-active] [data-testid="workbench-placeholder"]')?.textContent
    ).toBe('browser 2')
    expect(container.querySelector('[data-testid="workbench-empty"]')).toBeNull()
    expect(container.querySelectorAll('[data-workbench-view].hidden')).toHaveLength(0)
    expect(container.querySelectorAll('[data-workbench-view].opacity-0')).toHaveLength(1)

    await act(async () => {
      container
        .querySelector<HTMLElement>(`[data-tab-id="${first}"] .larify-workbench-tab-trigger`)
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    })
    expect(store.getState().activeViewId).toBe(first)
    expect(
      container.querySelector('[data-active] [data-testid="workbench-placeholder"]')?.textContent
    ).toBe('terminal 1')

    await act(async () => {
      container
        .querySelector<HTMLElement>(`[data-tab-id="${second}"] .larify-workbench-tab-close`)
        ?.click()
    })
    expect(store.getState().views.map((view) => view.id)).toEqual([first])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('resource:close-many', [2]))
  })

  it('unmounts all closing views before closing their resources as one batch', async () => {
    const disposed: number[] = []
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
      component: (props) => createElement(DisposableTestRenderer, { ...props, disposed }),
      icon: null,
      order: 10,
      title: 'Terminal'
    })
    const store = createWorkbenchStore()
    const first = store.getState().openView({ rendererId: 'terminal', resourceId: 1 })
    const second = store.getState().openView({ rendererId: 'terminal', resourceId: 2 })
    store.getState().selectView(first)
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
    })
    await act(async () => store.getState().selectView(second))
    invoke.mockImplementation((channel: string, ids: number[]) => {
      if (channel === 'resource:close-many') expect(disposed).toEqual([1])
      return Promise.resolve(ids)
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`[data-tab-id="${first}"] .larify-workbench-tab-close`)
        ?.click()
    })

    expect(store.getState().views.map(({ resourceId }) => resourceId)).toEqual([2])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('resource:close-many', [1]))
  })

  it('switches the active view and renderer with arrow keys', async () => {
    const store = createWorkbenchStore()
    const first = store.getState().openView({ rendererId: 'terminal', resourceId: 1 })
    const second = store.getState().openView({ rendererId: 'browser', resourceId: 2 })
    store.getState().selectView(first)
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
    })

    const activeTab = container.querySelector<HTMLElement>(
      `[data-tab-id="${first}"] .larify-workbench-tab-trigger`
    )!
    await act(async () => {
      activeTab.focus()
      activeTab.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, code: 'ArrowRight', key: 'ArrowRight' })
      )
    })

    expect(store.getState().activeViewId).toBe(second)
    expect(
      container.querySelector('[data-active] [data-testid="workbench-placeholder"]')?.textContent
    ).toBe('browser 2')
  })

  it('renders a component registered for the active renderer id', async () => {
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
      component: ({ resourceId, updateTab }) =>
        createElement(
          'button',
          { 'data-testid': 'terminal-renderer', onClick: () => updateTab({ title: 'PowerShell' }) },
          resourceId
        ),
      icon: null,
      order: 10,
      title: 'Terminal'
    })
    const store = createWorkbenchStore()
    store.getState().openView({ rendererId: 'terminal', resourceId: 7 })

    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
    })

    expect(container.querySelector('[data-testid="terminal-renderer"]')?.textContent).toBe('7')
    expect(container.querySelector('[data-testid="workbench-placeholder"]')).toBeNull()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="terminal-renderer"]')?.click()
    })
    expect(
      container.querySelector('[data-state="active"] .larify-workbench-tab-title')?.textContent
    ).toBe('PowerShell')
  })

  it('binds a tab before its renderer is selected and disposes the binding', async () => {
    const dispose = vi.fn()
    const bindTab = vi.fn(({ updateTab }) => {
      updateTab({ title: 'PowerShell' })
      return { dispose }
    })
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
      bindTab,
      component: vi.fn(() => null),
      icon: null,
      order: 10,
      title: 'Terminal'
    })
    const store = createWorkbenchStore()
    store.getState().openView({ rendererId: 'terminal', resourceId: 7 })
    store.getState().showLauncher()

    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, {
            cwd: 'D:\\workspace',
            onOpenTool: vi.fn(),
            sessionId: 'session-1',
            store
          })
        )
      )
    })

    expect(bindTab).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: 'D:\\workspace',
        resourceId: 7,
        sessionId: 'session-1'
      })
    )
    expect(store.getState().activeViewId).toBeNull()
    expect(store.getState().views[0].title).toBe('PowerShell')

    await act(async () => root.unmount())
    expect(dispose).toHaveBeenCalledOnce()
    root = createRoot(container)
  })

  it('ignores tab updates from a disposed binding', async () => {
    const updates: Array<(tab: { title: string }) => void> = []
    const dispose = vi.fn()
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
      bindTab: ({ updateTab }) => {
        updates.push(updateTab)
        return { dispose }
      },
      component: vi.fn(() => null),
      icon: null,
      order: 10,
      title: 'Terminal'
    })
    const store = createWorkbenchStore()
    const viewId = store.getState().openView({ rendererId: 'terminal', resourceId: 7 })

    const render = async (cwd: string): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(
            RendererRegistryProvider,
            { registry },
            createElement(WorkbenchShell, {
              cwd,
              onOpenTool: vi.fn(),
              sessionId: 'session-1',
              store
            })
          )
        )
      })
    }

    await render('D:\\first')
    await render('D:\\second')
    expect(dispose).toHaveBeenCalledOnce()

    await act(async () => {
      updates[0]({ title: 'Stale' })
      updates[1]({ title: 'Current' })
    })
    expect(store.getState().views.find((view) => view.id === viewId)?.title).toBe('Current')
  })

  it('renders the shared tool launcher and forwards its selection', async () => {
    const onOpenTool = vi.fn()
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
      component: vi.fn(() => null),
      icon: null,
      order: 10,
      title: '终端'
    })
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, {
            onOpenTool,
            store: createWorkbenchStore()
          })
        )
      )
    })

    expect(container.querySelector('[data-testid="workbench-empty"]')).not.toBeNull()
    expect(container.querySelector('h2')?.textContent).toBe('打开标签页')
    expect(container.querySelector('.larify-workbench-home')?.hasAttribute('data-active')).toBe(
      true
    )
    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('[data-testid="workbench-empty"] button')
      )
        .find((button) => button.textContent === '终端')
        ?.click()
    })
    expect(onOpenTool).toHaveBeenCalledWith('terminal')
  })

  it('shows the launcher without creating a placeholder tab', async () => {
    const store = createWorkbenchStore()
    store.getState().openView({ rendererId: 'browser', resourceId: 1 })
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.larify-workbench-home')?.click()
    })

    expect(store.getState().activeViewId).toBeNull()
    expect(store.getState().views).toHaveLength(1)
    expect(container.querySelector('[data-testid="workbench-empty"]')).not.toBeNull()
    expect(container.querySelector('[data-workbench-view]')?.classList.contains('opacity-0')).toBe(
      true
    )
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('updates the launcher when a renderer is registered after mounting', async () => {
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store: createWorkbenchStore() })
        )
      )
    })
    expect(container.querySelector('[data-testid="workbench-empty"] button')).toBeNull()

    let registration: Disposable | undefined
    await act(async () => {
      registration = registry
        .get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
        ?.register('terminal', {
          component: vi.fn(() => null),
          icon: null,
          order: 10,
          title: 'Terminal'
        })
    })

    expect(container.querySelector('[data-testid="workbench-empty"] button')?.textContent).toBe(
      'Terminal'
    )

    await act(async () => registration?.dispose())
    expect(container.querySelector('[data-testid="workbench-empty"] button')).toBeNull()
  })

  it('replaces an active placeholder when its renderer is registered', async () => {
    const store = createWorkbenchStore()
    store.getState().openView({ rendererId: 'terminal', resourceId: 7 })
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
    })
    expect(container.querySelector('[data-testid="workbench-placeholder"]')).not.toBeNull()

    await act(async () => {
      registry
        .get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
        ?.register('terminal', {
          component: () => createElement('div', { 'data-testid': 'terminal-renderer' }),
          icon: createElement('span'),
          order: 10,
          title: 'Terminal'
        })
    })

    expect(container.querySelector('[data-testid="workbench-placeholder"]')).toBeNull()
    expect(container.querySelector('[data-testid="terminal-renderer"]')).not.toBeNull()
  })

  it('restores the placeholder when an active renderer is unregistered', async () => {
    const registration = registry
      .get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
      ?.register('terminal', {
        component: () => createElement('div', { 'data-testid': 'terminal-renderer' }),
        icon: createElement('span'),
        order: 10,
        title: 'Terminal'
      })
    const store = createWorkbenchStore()
    store.getState().openView({ rendererId: 'terminal', resourceId: 7 })
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
    })
    expect(container.querySelector('[data-testid="terminal-renderer"]')).not.toBeNull()

    await act(async () => registration?.dispose())

    expect(container.querySelector('[data-testid="terminal-renderer"]')).toBeNull()
    expect(container.querySelector('[data-testid="workbench-placeholder"]')?.textContent).toBe(
      'terminal 7'
    )
  })

  it('keeps renderer component state scoped to its view', async () => {
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
      component: StatefulTestRenderer,
      icon: createElement('span'),
      order: 10,
      title: 'Terminal'
    })
    const store = createWorkbenchStore()
    const first = store.getState().openView({ rendererId: 'terminal', resourceId: 1 })
    const second = store.getState().openView({ rendererId: 'terminal', resourceId: 2 })
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
    })
    expect(
      container.querySelector('[data-active] [data-testid="renderer-state"]')?.textContent
    ).toBe('2')

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-active] [data-testid="renderer-state"]')
        ?.click()
    })

    await act(async () => store.getState().selectView(first))

    expect(
      container.querySelector('[data-active] [data-testid="renderer-state"]')?.textContent
    ).toBe('1')

    await act(async () => store.getState().selectView(second))
    expect(
      container.querySelector('[data-active] [data-testid="renderer-state"]')?.textContent
    ).toBe('3')
  })

  it('keeps a mounted renderer inactive while its session is hidden', async () => {
    const activeStates: boolean[] = []
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('browser', {
      component: ({ active }) => {
        activeStates.push(active)
        return createElement('div', { 'data-testid': 'browser-renderer' })
      },
      icon: createElement('span'),
      order: 10,
      title: 'Browser'
    })
    const store = createWorkbenchStore()
    store.getState().openView({ rendererId: 'browser', resourceId: 1 })
    const render = async (active: boolean): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(
            RendererRegistryProvider,
            { registry },
            createElement(WorkbenchShell, { active, onOpenTool: vi.fn(), store })
          )
        )
      })
    }

    await render(true)
    await render(false)
    expect(activeStates.at(-1)).toBe(false)
    expect(container.querySelector('[data-workbench-view]')?.getAttribute('aria-hidden')).toBe(
      'true'
    )
    expect(container.querySelector('[data-testid="browser-renderer"]')).not.toBeNull()

    await render(true)
    expect(activeStates.at(-1)).toBe(true)
  })

  it('shows tab actions only for the active renderer', async () => {
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('workspace', {
      component: TabActionRenderer,
      icon: createElement('span'),
      order: 10,
      title: 'Workspace'
    })
    const store = createWorkbenchStore()
    const first = store.getState().openView({ rendererId: 'workspace', resourceId: 1 })
    store.getState().openView({ rendererId: 'workspace', resourceId: 2 })

    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
    })
    expect(container.querySelector('[data-testid="tab-action"]')?.textContent).toBe('action 2')

    await act(async () => store.getState().selectView(first))
    expect(container.querySelector('[data-testid="tab-action"]')?.textContent).toBe('action 1')

    await act(async () => store.getState().showLauncher())
    expect(container.querySelector('[data-testid="tab-action"]')).toBeNull()
  })

  it('applies renderer tab updates to the currently rendered view', async () => {
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
      component: ({ resourceId, updateTab }) =>
        createElement(
          'button',
          {
            'data-testid': 'update-renderer-tab',
            onClick: () =>
              updateTab({
                title: `Terminal ${resourceId}`,
                tooltip: `D:\\workspace\\terminal-${resourceId}`
              })
          },
          resourceId
        ),
      icon: createElement('span'),
      order: 10,
      title: 'Terminal'
    })
    const store = createWorkbenchStore()
    const first = store.getState().openView({ rendererId: 'terminal', resourceId: 1 })
    store.getState().openView({ rendererId: 'terminal', resourceId: 2 })
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
      store.getState().selectView(first)
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-active] [data-testid="update-renderer-tab"]')
        ?.click()
    })

    expect(store.getState().views.find((view) => view.id === first)?.title).toBe('Terminal 1')
    expect(store.getState().views.find((view) => view.id !== first)?.title).toBeUndefined()
    expect(
      container
        .querySelector(`[data-tab-id="${first}"] .larify-workbench-tab-trigger`)
        ?.getAttribute('title')
    ).toBe('D:\\workspace\\terminal-1')
  })

  it('does not rerender mounted renderer content for presentation-only tab updates', async () => {
    const renders = new Map<number, number>()
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
      component: ({ resourceId }) => {
        renders.set(resourceId, (renders.get(resourceId) ?? 0) + 1)
        return createElement('div', { 'data-testid': `renderer-${resourceId}` })
      },
      icon: createElement('span'),
      order: 10,
      title: 'Terminal'
    })
    const store = createWorkbenchStore()
    const first = store.getState().openView({ rendererId: 'terminal', resourceId: 1 })
    const second = store.getState().openView({ rendererId: 'terminal', resourceId: 2 })
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchShell, { onOpenTool: vi.fn(), store })
        )
      )
      store.getState().selectView(first)
    })
    const before = new Map(renders)

    await act(async () => store.getState().updateTab(second, { title: 'Updated title' }))

    expect(renders).toEqual(before)
    expect(
      container
        .querySelector(`[data-tab-id="${second}"] .larify-workbench-tab-title`)
        ?.textContent?.trim()
    ).toBe('Updated title')
  })
})

function StatefulTestRenderer({ resourceId }: { resourceId: number }): React.JSX.Element {
  const [value, setValue] = useState(resourceId)
  return createElement(
    'button',
    { 'data-testid': 'renderer-state', onClick: () => setValue((current) => current + 1) },
    value
  )
}

function TabActionRenderer({ resourceId }: { resourceId: number }): React.JSX.Element {
  const action = useMemo(
    () => createElement('span', { 'data-testid': 'tab-action' }, `action ${resourceId}`),
    [resourceId]
  )
  useWorkbenchTabActions(action)
  return createElement('span', null, resourceId)
}

function DisposableTestRenderer({
  disposed,
  resourceId
}: {
  disposed: number[]
  resourceId: number
}): null {
  useEffect(() => () => void disposed.push(resourceId), [disposed, resourceId])
  return null
}

class ResizeObserverMock {
  disconnect(): void {
    return
  }
  observe(): void {
    return
  }
  unobserve(): void {
    return
  }
}
