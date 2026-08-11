// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { RendererRegistryProvider } from '../../../../src/renderer/src/app/registry/renderer-registry-provider'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'
import { Workbench } from '../../../../src/renderer/src/app/workbench/workbench'

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
