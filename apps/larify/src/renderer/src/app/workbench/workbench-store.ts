import { createStore, type StoreApi } from 'zustand/vanilla'
import type { RendererResource } from '../registry/renderer-resource'
import type { WorkbenchTabPresentation } from '../registry/workbench-renderers'
import type { Resource } from '@shared/resource'

export interface WorkbenchView extends RendererResource, Partial<WorkbenchTabPresentation> {
  id: number
}

interface WorkbenchViewState {
  activeViewId: number | null
  views: WorkbenchView[]
  closeViews(ids: readonly number[]): void
  openView(resource: RendererResource): number
  reorderView(id: number, toIndex: number): void
  selectView(id: number): void
  showLauncher(): void
  syncResources(resources: Resource[]): void
  updateTab(id: number, tab: Partial<WorkbenchTabPresentation>): void
}

export const createWorkbenchStore = (): StoreApi<WorkbenchViewState> => {
  let nextViewId = 1

  return createStore<WorkbenchViewState>((set, get) => ({
    activeViewId: null,
    views: [],

    closeViews(ids) {
      const { activeViewId, views } = get()
      const closed = new Set(ids)
      if (!views.some((view) => closed.has(view.id))) return

      const activeIndex = views.findIndex((view) => view.id === activeViewId)
      const nextViews = views.filter((view) => !closed.has(view.id))
      const nextActiveViewId =
        activeViewId !== null && closed.has(activeViewId)
          ? (views.slice(activeIndex + 1).find((view) => !closed.has(view.id))?.id ??
            nextViews.at(-1)?.id ??
            null)
          : activeViewId
      set({ activeViewId: nextActiveViewId, views: nextViews })
    },

    openView(resource) {
      const existing = get().views.find(
        (view) => view.rendererId === resource.rendererId && view.resourceId === resource.resourceId
      )
      if (existing) {
        set({ activeViewId: existing.id })
        return existing.id
      }

      const view = { ...resource, id: nextViewId++ }
      set((state) => ({ activeViewId: view.id, views: [...state.views, view] }))
      return view.id
    },

    reorderView(id, toIndex) {
      const views = get().views
      const fromIndex = views.findIndex((view) => view.id === id)
      if (fromIndex === -1 || fromIndex === toIndex || toIndex < 0 || toIndex >= views.length)
        return

      const nextViews = [...views]
      const [view] = nextViews.splice(fromIndex, 1)
      nextViews.splice(toIndex, 0, view)
      set({ views: nextViews })
    },

    selectView(id) {
      if (get().views.some((view) => view.id === id)) set({ activeViewId: id })
    },

    showLauncher() {
      set({ activeViewId: null })
    },

    syncResources(resources) {
      const { activeViewId: currentActiveViewId, views: current } = get()
      const resourcesByKey = new Map<string, Resource>()
      for (const resource of resources) {
        const key = `${resource.type}:${resource.id}`
        if (!resourcesByKey.has(key)) resourcesByKey.set(key, resource)
      }
      const retained = current.filter((view) =>
        resourcesByKey.has(`${view.rendererId}:${view.resourceId}`)
      )
      const known = new Set(retained.map((view) => `${view.rendererId}:${view.resourceId}`))
      const added = [...resourcesByKey.values()]
        .filter((resource) => !known.has(`${resource.type}:${resource.id}`))
        .map((resource) => ({
          id: nextViewId++,
          rendererId: resource.type,
          resourceId: resource.id
        }))
      const views = [...retained, ...added]
      const currentActiveIndex = current.findIndex((view) => view.id === currentActiveViewId)
      const activeViewId = views.some((view) => view.id === currentActiveViewId)
        ? currentActiveViewId
        : currentActiveViewId === null
          ? null
          : (views[Math.min(currentActiveIndex, views.length - 1)]?.id ?? null)
      set({ activeViewId, views })
    },

    updateTab(id, tab) {
      set((state) => {
        const view = state.views.find((item) => item.id === id)
        const unchanged =
          view &&
          (!('icon' in tab) || view.icon === tab.icon) &&
          (!('title' in tab) || view.title === tab.title) &&
          (!('tooltip' in tab) || view.tooltip === tab.tooltip)
        if (!view || unchanged) return state
        return {
          views: state.views.map((item) => (item.id === id ? { ...item, ...tab } : item))
        }
      })
    }
  }))
}

export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>
