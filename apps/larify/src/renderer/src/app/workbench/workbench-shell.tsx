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
import { WorkbenchTabActionScope } from './workbench-tab-actions'

interface WorkbenchShellProps {
  cwd: string
  store: WorkbenchStore
  sessionId: string
  onOpenTool(id: string): void
}

export function WorkbenchShell({
  cwd,
  store,
  sessionId,
  onOpenTool
}: WorkbenchShellProps): React.JSX.Element {
  const registry = useRendererRegistry()
  const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
  const [, refreshTabs] = useReducer((value: number) => value + 1, 0)
  useEffect(() => registry.subscribe(workbenchRendererRegistryToken, refreshTabs), [registry])
  const { activeViewId, closeViews, reorderView, selectView, showLauncher, updateTab, views } =
    useStore(store)
  const activeView = views.find((view) => view.id === activeViewId) ?? null

  return (
    <WorkbenchTabsLayout
      activeId={activeViewId === null ? null : String(activeViewId)}
      tabs={views.map((view) => toTab(view, renderers))}
      onClose={(ids) => {
        const viewIds = new Set(ids.map(Number))
        const closing = views.filter((view) => viewIds.has(view.id))
        if (closing.length === 0) return
        closeViews(closing.map((view) => view.id))
        window.setTimeout(() => {
          void window.bridge
            ?.invoke(
              'resource:close-many',
              closing.map((view) => view.resourceId)
            )
            .catch(() => undefined)
        }, 0)
      }}
      onHome={showLauncher}
      onReorder={(id, _fromIndex, toIndex) => reorderView(Number(id), toIndex)}
      onSelect={(id) => selectView(Number(id))}
    >
      <Fragment>
        {views.map((view) => (
          <WorkbenchTabBinding
            cwd={cwd}
            key={`binding:${view.id}`}
            renderers={renderers}
            sessionId={sessionId}
            updateTab={updateTab}
            view={view}
          />
        ))}
        {activeView === null && (
          <WorkbenchRenderer
            cwd={cwd}
            onOpenTool={onOpenTool}
            onUpdateTab={updateTab}
            sessionId={sessionId}
            view={null}
          />
        )}
        {views.map((view) => (
          <div
            aria-hidden={view.id !== activeViewId}
            className={`absolute inset-0 h-full ${
              view.id === activeViewId ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            data-active={view.id === activeViewId || undefined}
            data-resource-id={view.resourceId}
            data-view-id={view.id}
            data-workbench-view={view.rendererId}
            key={`view:${view.id}`}
          >
            <WorkbenchTabActionScope active={view.id === activeViewId}>
              <WorkbenchRenderer
                active={view.id === activeViewId}
                cwd={cwd}
                onOpenTool={onOpenTool}
                onUpdateTab={updateTab}
                sessionId={sessionId}
                view={view}
              />
            </WorkbenchTabActionScope>
          </div>
        ))}
      </Fragment>
    </WorkbenchTabsLayout>
  )
}

function WorkbenchTabBinding({
  cwd,
  renderers,
  sessionId,
  updateTab,
  view
}: {
  cwd: string
  renderers: WorkbenchRendererRegistry | undefined
  sessionId: string
  updateTab(id: number, tab: Partial<WorkbenchTabPresentation>): void
  view: WorkbenchView
}): null {
  const bindTab = renderers?.get(view.rendererId)?.bindTab
  useEffect(() => {
    let active = true
    const binding = bindTab?.({
      cwd,
      resourceId: view.resourceId,
      sessionId,
      updateTab: (tab) => {
        if (active) updateTab(view.id, tab)
      }
    })
    return () => {
      active = false
      void binding?.dispose()
    }
  }, [bindTab, cwd, sessionId, updateTab, view.id, view.resourceId])
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
    title: view.title ?? renderer?.title ?? `${view.rendererId} ${view.resourceId}`,
    tooltip: view.tooltip
  }
}
