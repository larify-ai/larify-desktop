import {
  Activity,
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useState
} from 'react'
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
import { WorkbenchActivationProvider } from './workbench-activation'

interface WorkbenchShellProps {
  active?: boolean
  cwd: string
  store: WorkbenchStore
  sessionId: string
  onOpenTool(id: string): void
}

const eagerRendererIds = new Set(['browser'])
const persistentRendererIds = new Set(['browser', 'changes', 'terminal', 'workspace'])
const deferredActivationRendererIds = new Set(['changes', 'workspace'])

export function WorkbenchShell({
  active = true,
  cwd,
  store,
  sessionId,
  onOpenTool
}: WorkbenchShellProps): React.JSX.Element {
  const registry = useRendererRegistry()
  const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
  const [rendererRevision, refreshTabs] = useReducer((value: number) => value + 1, 0)
  useEffect(() => registry.subscribe(workbenchRendererRegistryToken, refreshTabs), [registry])
  const { activeViewId, closeViews, reorderView, selectView, showLauncher, updateTab, views } =
    useStore(store)
  const activeView = views.find((view) => view.id === activeViewId) ?? null
  const tabs = useMemo(() => views.map((view) => toTab(view, renderers)), [renderers, views])
  const handleClose = useCallback(
    (ids: string[]): void => {
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
    },
    [closeViews, views]
  )
  const handleReorder = useCallback(
    (id: string, _fromIndex: number, toIndex: number): void => reorderView(Number(id), toIndex),
    [reorderView]
  )
  const handleSelect = useCallback((id: string): void => selectView(Number(id)), [selectView])

  return (
    <WorkbenchTabsLayout
      activeId={activeViewId === null ? null : String(activeViewId)}
      tabs={tabs}
      onClose={handleClose}
      onHome={showLauncher}
      onReorder={handleReorder}
      onSelect={handleSelect}
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
        {views.map((view) => {
          const viewActive = active && view.id === activeViewId
          return (
            <div
              aria-hidden={!viewActive}
              className={`absolute inset-0 h-full ${
                viewActive ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
              data-active={viewActive || undefined}
              data-resource-id={view.resourceId}
              data-view-id={view.id}
              data-workbench-view={view.rendererId}
              key={`view:${view.id}`}
            >
              <ActivatedWorkbenchRenderer
                active={viewActive}
                cwd={cwd}
                onOpenTool={onOpenTool}
                onUpdateTab={updateTab}
                rendererRevision={rendererRevision}
                sessionId={sessionId}
                view={view}
              />
            </div>
          )
        })}
      </Fragment>
    </WorkbenchTabsLayout>
  )
}

const ActivatedWorkbenchRenderer = memo(function ActivatedWorkbenchRenderer(
  props: React.ComponentProps<typeof WorkbenchRenderer> & { rendererRevision: number }
): React.JSX.Element | null {
  const rendererId = props.view?.rendererId ?? ''
  const eager = eagerRendererIds.has(rendererId)
  const persistent = persistentRendererIds.has(rendererId)
  const deferActivation = deferredActivationRendererIds.has(rendererId)
  const shouldMount = Boolean(props.active || eager)
  const [activated, setActivated] = useState(shouldMount)
  const deferredActive = useDeferredValue(Boolean(props.active))
  if (shouldMount && !activated) setActivated(true)
  const rendererActive = deferActivation ? deferredActive : Boolean(props.active)
  const stableRendererActive = rendererId === 'workspace' ? true : rendererActive
  return activated || props.active ? (
    <WorkbenchTabActionScope active={rendererActive}>
      <Activity mode={props.active || persistent ? 'visible' : 'hidden'}>
        <WorkbenchActivationProvider active={rendererActive}>
          <StableWorkbenchRenderer {...props} active={stableRendererActive} />
        </WorkbenchActivationProvider>
      </Activity>
    </WorkbenchTabActionScope>
  ) : null
}, sameRendererProps)

const StableWorkbenchRenderer = memo(WorkbenchRenderer)

function sameRendererProps(
  previous: React.ComponentProps<typeof WorkbenchRenderer> & { rendererRevision: number },
  next: React.ComponentProps<typeof WorkbenchRenderer> & { rendererRevision: number }
): boolean {
  return (
    previous.active === next.active &&
    previous.cwd === next.cwd &&
    previous.onOpenTool === next.onOpenTool &&
    previous.onUpdateTab === next.onUpdateTab &&
    previous.rendererRevision === next.rendererRevision &&
    previous.sessionId === next.sessionId &&
    previous.view?.id === next.view?.id &&
    previous.view?.rendererId === next.view?.rendererId &&
    previous.view?.resourceId === next.view?.resourceId
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
