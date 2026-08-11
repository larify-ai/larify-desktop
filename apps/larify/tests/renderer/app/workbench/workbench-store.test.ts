import { describe, expect, it } from 'vitest'
import type { RendererResource } from '../../../../src/renderer/src/app/registry/renderer-resource'
import { createWorkbenchStore } from '../../../../src/renderer/src/app/workbench/workbench-store'

const terminal = (resourceId: number): RendererResource => ({
  rendererId: 'terminal',
  resourceId
})

describe('workbench store', () => {
  it('opens and activates views with store-owned numeric ids', () => {
    const store = createWorkbenchStore()

    expect(store.getState().openView(terminal(7))).toBe(1)
    expect(store.getState().openView(terminal(8))).toBe(2)
    expect(store.getState()).toMatchObject({
      activeViewId: 2,
      views: [
        { id: 1, resourceId: 7 },
        { id: 2, resourceId: 8 }
      ]
    })
  })

  it('reuses and activates a view for the same renderer resource', () => {
    const store = createWorkbenchStore()
    const id = store.getState().openView(terminal(7))
    store.getState().openView(terminal(8))

    expect(store.getState().openView(terminal(7))).toBe(id)
    expect(store.getState().activeViewId).toBe(id)
    expect(store.getState().views).toHaveLength(2)
  })

  it('allows different renderers to view the same resource id', () => {
    const store = createWorkbenchStore()
    store.getState().openView(terminal(7))
    store.getState().openView({ rendererId: 'browser', resourceId: 7 })

    expect(store.getState().views).toHaveLength(2)
  })

  it('shows the launcher without creating or removing views', () => {
    const store = createWorkbenchStore()
    const first = store.getState().openView(terminal(7))
    store.getState().showLauncher()

    expect(store.getState()).toMatchObject({
      activeViewId: null,
      views: [{ id: first, rendererId: 'terminal' }]
    })
  })

  it('selects existing views and ignores stale ids', () => {
    const store = createWorkbenchStore()
    const first = store.getState().openView(terminal(7))
    store.getState().openView(terminal(8))

    store.getState().selectView(first)
    expect(store.getState().activeViewId).toBe(first)
    store.getState().selectView(99)
    expect(store.getState().activeViewId).toBe(first)
  })

  it('closes only the view and chooses the adjacent active view', () => {
    const store = createWorkbenchStore()
    const first = store.getState().openView(terminal(7))
    const second = store.getState().openView(terminal(8))
    const third = store.getState().openView(terminal(9))

    store.getState().selectView(second)
    store.getState().closeView(second)
    expect(store.getState().activeViewId).toBe(third)

    store.getState().closeView(third)
    expect(store.getState().activeViewId).toBe(first)

    store.getState().closeView(first)
    expect(store.getState()).toMatchObject({ activeViewId: null, views: [] })
  })

  it('keeps the active view when closing an inactive or stale view', () => {
    const store = createWorkbenchStore()
    const first = store.getState().openView(terminal(7))
    const second = store.getState().openView(terminal(8))

    store.getState().closeView(first)
    store.getState().closeView(99)
    expect(store.getState().activeViewId).toBe(second)
  })

  it('reorders by id and rejects stale or out-of-range moves', () => {
    const store = createWorkbenchStore()
    const first = store.getState().openView(terminal(7))
    const second = store.getState().openView(terminal(8))
    const third = store.getState().openView(terminal(9))

    store.getState().reorderView(first, 2)
    expect(store.getState().views.map((view) => view.id)).toEqual([second, third, first])

    store.getState().reorderView(99, 0)
    store.getState().reorderView(first, -1)
    store.getState().reorderView(first, 3)
    expect(store.getState().views.map((view) => view.id)).toEqual([second, third, first])
  })

  it('updates presentation for one view', () => {
    const store = createWorkbenchStore()
    const first = store.getState().openView(terminal(7))
    store.getState().openView(terminal(8))

    store.getState().updateTab(first, { title: 'PowerShell' })

    expect(store.getState().views[0]).toMatchObject({ id: first, title: 'PowerShell' })
    expect(store.getState().views[1]).not.toHaveProperty('title')
  })

  it('synchronizes resources while preserving existing view presentation and ids', () => {
    const store = createWorkbenchStore()
    store.getState().syncResources([
      { id: 7, sessionId: 'session', type: 'terminal' },
      { id: 8, sessionId: 'session', type: 'terminal' }
    ])
    const [first, second] = store.getState().views
    store.getState().updateTab(first.id, { title: 'PowerShell' })

    store.getState().syncResources([
      { id: 8, sessionId: 'session', type: 'terminal' },
      { id: 7, sessionId: 'session', type: 'terminal' },
      { id: 9, sessionId: 'session', type: 'terminal' }
    ])

    expect(store.getState().views).toEqual([
      { ...first, title: 'PowerShell' },
      second,
      { id: 3, rendererId: 'terminal', resourceId: 9 }
    ])
  })

  it('selects an adjacent view when the active resource disappears', () => {
    const store = createWorkbenchStore()
    store.getState().syncResources([
      { id: 7, sessionId: 'session', type: 'terminal' },
      { id: 8, sessionId: 'session', type: 'terminal' },
      { id: 9, sessionId: 'session', type: 'terminal' }
    ])
    const [, second, third] = store.getState().views
    store.getState().selectView(second.id)

    store.getState().syncResources([
      { id: 7, sessionId: 'session', type: 'terminal' },
      { id: 9, sessionId: 'session', type: 'terminal' }
    ])

    expect(store.getState().activeViewId).toBe(third.id)
  })

  it('does not create duplicate views for duplicate resource snapshots', () => {
    const store = createWorkbenchStore()
    const resource = { id: 7, sessionId: 'session', type: 'terminal' }

    store.getState().syncResources([resource, resource])

    expect(store.getState().views).toHaveLength(1)
  })
})
