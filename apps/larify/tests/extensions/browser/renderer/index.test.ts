// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import plugin from '../../../../src/extensions/browser/renderer'
import { Registry } from '../../../../src/shared/infra/registry'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('browser renderer plugin', () => {
  it('registers one Workbench renderer and updates its tab presentation', async () => {
    let stateListener!: (value: unknown) => void
    const invoke = vi.fn().mockResolvedValue({ id: 7, title: 'Initial', favIconUrl: '' })
    const on = vi.fn((_channel: string, listener: (value: unknown) => void) => {
      stateListener = listener
      return vi.fn()
    })
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: {
        invoke,
        on
      }
    })
    const registry = new Registry()
    const renderers = new WorkbenchRendererRegistry(registry)
    registry.register(workbenchRendererRegistryToken, renderers)
    const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
    plugin.activate({ registry, subscriptions })
    const renderer = renderers.get('browser')!
    expect(renderer).toMatchObject({ order: 40, title: '浏览器' })

    const updateTab = vi.fn()
    const binding = renderer.bindTab!({ resourceId: 7, sessionId: 'session-a', updateTab })
    expect(updateTab).toHaveBeenCalledWith(expect.objectContaining({ title: '新标签页' }))
    await Promise.resolve()
    expect(on.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0])
    expect(invoke).toHaveBeenCalledWith('browser:getState', 'session-a', 7)
    expect(updateTab).toHaveBeenCalledWith(expect.objectContaining({ title: 'Initial' }))

    stateListener({
      sessionId: 'session-a',
      state: {
        tabs: [{ id: 7, title: 'Updated', favIconUrl: 'https://example.com/favicon.ico' }]
      }
    })
    expect(updateTab).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Updated' }))
    const updateCount = updateTab.mock.calls.length
    stateListener({
      sessionId: 'session-a',
      state: {
        tabs: [{ id: 7, title: 'Updated', favIconUrl: 'https://example.com/favicon.ico' }]
      }
    })
    expect(updateTab).toHaveBeenCalledTimes(updateCount)

    stateListener({
      sessionId: 'session-a',
      state: {
        tabs: [{ id: 7, title: 'Renamed', favIconUrl: 'https://example.com/favicon.ico' }]
      }
    })
    expect(updateTab).toHaveBeenLastCalledWith({ title: 'Renamed' })
    const host = document.createElement('div')
    const root = createRoot(host)
    const presentation = updateTab.mock.calls[updateCount - 1]?.[0] as { icon: ReactNode }
    await act(async () => root.render(presentation.icon))
    expect(host.querySelector('canvas')).toBeTruthy()
    await act(async () => root.unmount())
    binding.dispose()
    await subscriptions[0].dispose()
    expect(renderers.get('browser')).toBeUndefined()
  })

  it('keeps the initial state when an unrelated tab changes first', async () => {
    let resolveState!: (value: unknown) => void
    let stateListener!: (value: unknown) => void
    const invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveState = resolve
        })
    )
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((_channel: string, listener: (value: unknown) => void) => {
          stateListener = listener
          return vi.fn()
        })
      }
    })
    const registry = new Registry()
    const renderers = new WorkbenchRendererRegistry(registry)
    registry.register(workbenchRendererRegistryToken, renderers)
    plugin.activate({ registry, subscriptions: [] })
    const updateTab = vi.fn()
    renderers.get('browser')!.bindTab!({
      resourceId: 7,
      sessionId: 'session-a',
      updateTab
    })

    stateListener({
      sessionId: 'session-a',
      state: { tabs: [{ id: 8, title: 'Other', favIconUrl: '' }] }
    })
    resolveState({ id: 7, title: 'Initial', favIconUrl: '' })
    await Promise.resolve()

    expect(updateTab).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Initial' }))
  })
})
