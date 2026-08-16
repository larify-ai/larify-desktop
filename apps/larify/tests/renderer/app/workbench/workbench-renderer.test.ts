// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { RendererRegistryProvider } from '../../../../src/renderer/src/app/registry/renderer-registry-provider'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken,
  type WorkbenchRendererProps
} from '../../../../src/renderer/src/app/registry/workbench-renderers'
import { WorkbenchRenderer } from '../../../../src/renderer/src/app/workbench/workbench-renderer'

describe('WorkbenchRenderer', () => {
  let container: HTMLDivElement
  let registry: Registry
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
    registry = new Registry()
    registry.register(workbenchRendererRegistryToken, new WorkbenchRendererRegistry(registry))
  })

  afterEach(() => {
    act(() => root.unmount())
  })

  it('passes the resource context and updates only the current view', async () => {
    let received: WorkbenchRendererProps | undefined
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('test', {
      component: (props) => {
        received = props
        return createElement('button', { onClick: () => props.updateTab({ title: 'Updated' }) })
      },
      icon: null,
      order: 1,
      title: 'Test'
    })
    const onUpdateTab = vi.fn()

    await render({ onUpdateTab, view: { id: 4, rendererId: 'test', resourceId: 7 } })

    expect(received).toMatchObject({
      cwd: 'D:\\Workspace',
      resourceId: 7,
      sessionId: 'session-1'
    })
    await act(async () => container.querySelector('button')?.click())
    expect(onUpdateTab).toHaveBeenCalledWith(4, { title: 'Updated' })
  })

  it('shows a stable fallback for an unavailable renderer', async () => {
    await render({ view: { id: 4, rendererId: 'missing', resourceId: 7 } })
    expect(container.querySelector('[data-testid="workbench-placeholder"]')?.textContent).toBe(
      'missing 7'
    )
  })

  it('updates cwd without remounting the renderer', async () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()
    let receivedCwd = ''
    function StatefulRenderer({ cwd }: WorkbenchRendererProps): null {
      receivedCwd = cwd
      useEffect(() => {
        mounted()
        return unmounted
      }, [])
      return null
    }
    registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)?.register('test', {
      component: StatefulRenderer,
      icon: null,
      order: 1,
      title: 'Test'
    })
    const view = { id: 4, rendererId: 'test', resourceId: 7 }

    await render({ cwd: 'D:\\First', view })
    await render({ cwd: 'D:\\Second', view })

    expect(receivedCwd).toBe('D:\\Second')
    expect(mounted).toHaveBeenCalledOnce()
    expect(unmounted).not.toHaveBeenCalled()
  })

  async function render(
    overrides: Partial<Parameters<typeof WorkbenchRenderer>[0]> = {}
  ): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(WorkbenchRenderer, {
            cwd: 'D:\\Workspace',
            onOpenTool: vi.fn(),
            onUpdateTab: vi.fn(),
            sessionId: 'session-1',
            view: null,
            ...overrides
          })
        )
      )
    })
  }
})
