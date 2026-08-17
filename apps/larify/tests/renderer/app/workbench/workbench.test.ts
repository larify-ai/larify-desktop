// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { RendererRegistryProvider } from '../../../../src/renderer/src/app/registry/renderer-registry-provider'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'
import { Workbench, WorkbenchHost } from '../../../../src/renderer/src/app/workbench/workbench'

describe('Workbench', () => {
  let container: HTMLDivElement
  let invoke: ReturnType<typeof vi.fn>
  let listeners: Map<string, (value: unknown) => void>
  let registry: Registry
  let root: Root
  let sessionId: string

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    listeners = new Map()
    invoke = vi.fn()
    Object.assign(window, {
      bridge: {
        invoke,
        on: (channel: string, listener: (value: unknown) => void) => {
          listeners.set(channel, listener)
          return () => {
            if (listeners.get(channel) === listener) listeners.delete(channel)
          }
        }
      }
    })
    registry = new Registry()
    registry.register(workbenchRendererRegistryToken, new WorkbenchRendererRegistry(registry))
    sessionId = `session-${crypto.randomUUID()}`
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('does not let the initial list overwrite a newer resource event', async () => {
    const initial = deferred<unknown>()
    invoke.mockImplementation((channel: string) =>
      channel === 'resource:list' ? initial.promise : Promise.resolve(undefined)
    )
    await renderWorkbench(root, registry, sessionId)

    await act(async () => {
      listeners.get('resource:change')?.([{ id: 7, sessionId, type: 'terminal' }])
    })
    initial.resolve([])
    await act(async () => initial.promise)

    expect(container.querySelector('[data-tab-id]')).not.toBeNull()
  })

  it('ignores a list response from a previous session', async () => {
    const oldList = deferred<unknown>()
    const oldSessionId = sessionId
    invoke.mockImplementation((_channel: string, query: { sessionId: string }) =>
      query.sessionId === oldSessionId ? oldList.promise : Promise.resolve([])
    )
    await renderWorkbench(root, registry, sessionId)
    const oldChange = listeners.get('resource:change')

    sessionId = `session-${crypto.randomUUID()}`
    await renderWorkbench(root, registry, sessionId)
    await act(async () => {
      oldChange?.([{ id: 8, sessionId: oldSessionId, type: 'terminal' }])
    })
    oldList.resolve([{ id: 7, sessionId: oldSessionId, type: 'terminal' }])
    await act(async () => oldList.promise)

    expect(container.querySelector('[data-tab-id]')).toBeNull()
  })

  it('clears the previous session while the next resource list is loading', async () => {
    const nextList = deferred<unknown>()
    const firstSessionId = sessionId
    invoke.mockImplementation((_channel: string, query: { sessionId: string }) =>
      query.sessionId === firstSessionId
        ? Promise.resolve([{ id: 7, sessionId: firstSessionId, type: 'terminal' }])
        : nextList.promise
    )
    await renderWorkbench(root, registry, sessionId)
    expect(container.querySelector('[data-tab-id]')).not.toBeNull()

    sessionId = `session-${crypto.randomUUID()}`
    await renderWorkbench(root, registry, sessionId)

    expect(container.querySelector('[data-tab-id]')).toBeNull()
    nextList.resolve([])
    await act(async () => nextList.promise)
  })

  it('restores the selected view when returning to a session', async () => {
    const firstSessionId = sessionId
    const secondSessionId = `session-${crypto.randomUUID()}`
    invoke.mockImplementation((_channel: string, query: { sessionId: string }) =>
      Promise.resolve(
        query.sessionId === firstSessionId
          ? [{ id: 7, sessionId: firstSessionId, type: 'terminal' }]
          : []
      )
    )
    registerTerminal(registry)
    await renderWorkbench(root, registry, firstSessionId)

    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-tab-id] .larify-workbench-tab-trigger')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true }))
    })
    expect(container.querySelector('[data-state="active"]')).not.toBeNull()

    await renderWorkbench(root, registry, secondSessionId)
    expect(container.querySelector('[data-tab-id]')).toBeNull()

    await renderWorkbench(root, registry, firstSessionId)
    expect(container.querySelector('[data-state="active"]')).not.toBeNull()
  })

  it('does not open a resource created for a previous session', async () => {
    const created = deferred<unknown>()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'resource:list') return Promise.resolve([])
      if (channel === 'resource:create') return created.promise
      return Promise.resolve(undefined)
    })
    registerTerminal(registry)
    await renderWorkbench(root, registry, sessionId, 'D:\\Workspace')
    const oldSessionId = sessionId

    await act(async () => {
      findTerminalButton(container)?.click()
      sessionId = `session-${crypto.randomUUID()}`
    })
    await renderWorkbench(root, registry, sessionId)
    created.resolve(7)
    await act(async () => created.promise)

    expect(invoke).toHaveBeenCalledWith('resource:create', 'terminal', oldSessionId, {
      cwd: 'D:\\Workspace'
    })
    expect(container.querySelector('[data-tab-id]')).toBeNull()
  })

  it('deduplicates a created resource already received through the change event', async () => {
    const created = deferred<unknown>()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'resource:list') return Promise.resolve([])
      if (channel === 'resource:create') return created.promise
      return Promise.resolve(undefined)
    })
    registerTerminal(registry)
    await renderWorkbench(root, registry, sessionId)

    await act(async () => findTerminalButton(container)?.click())
    await act(async () => {
      listeners.get('resource:change')?.([{ id: 7, sessionId, type: 'terminal' }])
    })
    created.resolve(7)
    await act(async () => created.promise)

    expect(container.querySelectorAll('[data-tab-id]')).toHaveLength(1)
    expect(container.querySelector('[data-state="active"]')?.textContent).toContain('Terminal')
  })

  it('selects a newly created resource requested by an active workbench view', async () => {
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'resource:list' ? [{ id: 7, sessionId, type: 'workspace' }] : undefined
      )
    )
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('workspace', {
      component: () => null,
      icon: createElement('span'),
      order: 30,
      title: 'Files'
    })
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('browser', {
      component: () => null,
      icon: createElement('span'),
      order: 20,
      title: 'Browser'
    })
    await renderWorkbench(root, registry, sessionId)

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-select-resource', {
          detail: { rendererId: 'browser', resourceId: 8, sessionId: 'another-session' }
        })
      )
    })
    expect(container.querySelector('[data-state="active"]')).toBeNull()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-select-resource', {
          detail: { rendererId: 'browser', resourceId: 8, sessionId }
        })
      )
    })

    expect(container.querySelector('[data-state="active"]')?.textContent).toContain('Browser')

    await act(async () => {
      listeners.get('resource:change')?.([
        { id: 7, sessionId, type: 'workspace' },
        { id: 8, sessionId, type: 'browser' }
      ])
    })
    expect(container.querySelector('[data-state="active"]')?.textContent).toContain('Browser')
  })

  it.each([
    ['workspace', 'Files'],
    ['changes', 'Changes']
  ])('creates a %s resource for the current project root', async (rendererId, title) => {
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'resource:create' ? 7 : [])
    )
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register(rendererId, {
      component: () => null,
      icon: createElement('span'),
      order: 30,
      title
    })
    await renderWorkbench(root, registry, sessionId, 'D:\\Workspace')

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === title)
        ?.click()
    })

    expect(invoke).toHaveBeenCalledWith('resource:create', rendererId, sessionId, {
      root: 'D:\\Workspace'
    })
  })

  it('keeps inactive tabs mounted and unmounts a closed tab', async () => {
    const mounted: number[] = []
    const unmounted: number[] = []
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'resource:list'
          ? [
              { id: 7, sessionId, type: 'tracked' },
              { id: 8, sessionId, type: 'tracked' }
            ]
          : undefined
      )
    )
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('tracked', {
      component: function TrackedRenderer({ resourceId }) {
        useEffect(() => {
          mounted.push(resourceId)
          return () => {
            unmounted.push(resourceId)
          }
        }, [resourceId])
        return createElement('div', { 'data-resource-id': resourceId })
      },
      icon: createElement('span'),
      order: 10,
      title: 'Tracked'
    })

    await renderWorkbench(root, registry, sessionId)

    expect(mounted).toEqual([7, 8])
    expect(container.querySelectorAll('[data-workbench-view]')).toHaveLength(2)
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-tab-id="1"] .larify-workbench-tab-close')
        ?.click()
    })
    expect(unmounted).toEqual([7])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('resource:close-many', [7]))
  })

  it('mounts only the active session and inactive sessions that own resources', async () => {
    const mounted: number[] = []
    const firstSessionId = sessionId
    const secondSessionId = `session-${crypto.randomUUID()}`
    invoke.mockResolvedValueOnce([{ id: 7, sessionId: secondSessionId, type: 'tracked' }])
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('tracked', {
      component: function TrackedRenderer({ resourceId }) {
        useEffect(() => {
          mounted.push(resourceId)
        }, [resourceId])
        return null
      },
      icon: createElement('span'),
      order: 10,
      title: 'Tracked'
    })
    const sessions = [session(firstSessionId), session(secondSessionId)]

    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchHost, { activeId: firstSessionId, sessions })
        )
      )
    })
    expect(mounted).toEqual([7])

    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchHost, { activeId: secondSessionId, sessions })
        )
      )
    })
    expect(mounted).toEqual([7])
  })
})

async function renderWorkbench(
  root: Root,
  registry: Registry,
  sessionId: string,
  cwd = ''
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        RendererRegistryProvider,
        { registry },
        createElement(Workbench, { sessionId, cwd })
      )
    )
  })
}

function registerTerminal(registry: Registry): void {
  registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('terminal', {
    component: () => null,
    icon: createElement('span'),
    order: 10,
    title: 'Terminal'
  })
}

function findTerminalButton(container: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent === 'Terminal'
  )
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const session = (id: string): { cwd: string; id: string } => ({ cwd: `D:\\${id}`, id })
