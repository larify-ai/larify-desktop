import { Fragment, useEffect, useReducer } from 'react'
import { useStore } from 'zustand'
import { useRendererRegistry } from '../registry/renderer-registry'
import {
  type WorkbenchRendererRegistry,
  type WorkbenchTabPresentation,
  workbenchRendererRegistryToken
} from '../registry/workbench-renderers'
import { WorkbenchRenderer } from './workbench-renderer'
import type { WorkbenchStore, WorkbenchView } from './workbench-store'
import type { WorkbenchTab } from './workbench-tabs'
import { WorkbenchTabsLayout } from './workbench-tabs-layout'

interface WorkbenchShellProps {
  store: WorkbenchStore
  sessionId: string
  onOpenTool(id: string): void
}

export function WorkbenchShell({
  store,
  sessionId,
  onOpenTool
}: WorkbenchShellProps): React.JSX.Element {
  const registry = useRendererRegistry()
  const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
  const [, refreshTabs] = useReducer((value: number) => value + 1, 0)
  useEffect(() => registry.subscribe(workbenchRendererRegistryToken, refreshTabs), [registry])
  const { activeViewId, closeView, reorderView, selectView, showLauncher, updateTab, views } =
    useStore(store)
  const activeView = views.find((view) => view.id === activeViewId) ?? null

  return (
    <WorkbenchTabsLayout
      activeId={activeViewId === null ? null : String(activeViewId)}
      tabs={views.map((view) => toTab(view, renderers))}
      onClose={(id) => {
        const viewId = Number(id)
        const view = views.find((item) => item.id === viewId)
        if (!view) return
        closeView(viewId)
        void window.bridge?.invoke('resource:close', view.resourceId).catch(() => undefined)
      }}
      onHome={showLauncher}
      onReorder={(id, _fromIndex, toIndex) => reorderView(Number(id), toIndex)}
      onSelect={(id) => selectView(Number(id))}
    >
      <Fragment>
        {views.map((view) => (
          <WorkbenchTabBinding
            key={view.id}
            renderers={renderers}
            sessionId={sessionId}
            updateTab={updateTab}
            view={view}
          />
        ))}
        <WorkbenchRenderer
          onOpenTool={onOpenTool}
          onUpdateTab={updateTab}
          sessionId={sessionId}
          view={activeView}
        />
      </Fragment>
    </WorkbenchTabsLayout>
  )
}

function WorkbenchTabBinding({
  renderers,
  sessionId,
  updateTab,
  view
}: {
  renderers: WorkbenchRendererRegistry | undefined
  sessionId: string
  updateTab(id: number, tab: Partial<WorkbenchTabPresentation>): void
  view: WorkbenchView
}): null {
  const bindTab = renderers?.get(view.rendererId)?.bindTab
  useEffect(
    () =>
      bindTab?.({
        resourceId: view.resourceId,
        sessionId,
        updateTab: (tab) => updateTab(view.id, tab)
      }).dispose,
    [bindTab, sessionId, updateTab, view.id, view.resourceId]
  )
  return null
}

const toTab = (
  view: WorkbenchView,
  renderers: WorkbenchRendererRegistry | undefined
): WorkbenchTab => {
  const renderer = renderers?.get(view.rendererId)
  return {
    icon: view.icon ?? renderer?.icon ?? null,
    id: String(view.id),
    title: view.title ?? renderer?.title ?? `${view.rendererId} ${view.resourceId}`
  }
}
