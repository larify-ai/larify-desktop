import { createElement, useCallback } from 'react'
import {
  type WorkbenchRendererRegistry,
  type WorkbenchTabPresentation,
  workbenchRendererRegistryToken
} from '../registry/workbench-renderers'
import { useRendererRegistry } from '../registry/renderer-registry'
import type { WorkbenchView } from './workbench-store'
import { WorkbenchEmpty } from './workbench-empty'

interface WorkbenchRendererSlotProps {
  cwd: string
  onOpenTool(id: string): void
  onUpdateTab(id: number, tab: Partial<WorkbenchTabPresentation>): void
  sessionId: string
  view: WorkbenchView | null
}

export function WorkbenchRenderer({
  cwd,
  onOpenTool,
  onUpdateTab,
  sessionId,
  view
}: WorkbenchRendererSlotProps): React.JSX.Element {
  const registry = useRendererRegistry()
  const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
  const viewId = view?.id
  const updateCurrentTab = useCallback(
    (tab: Partial<WorkbenchTabPresentation>): void => {
      if (viewId !== undefined) onUpdateTab(viewId, tab)
    },
    [onUpdateTab, viewId]
  )

  if (!view) {
    return <WorkbenchEmpty renderers={renderers} onOpenTool={onOpenTool} />
  }

  const renderer = renderers?.get(view.rendererId)
  if (renderer) {
    return createElement(renderer.component, {
      cwd,
      resourceId: view.resourceId,
      sessionId,
      updateTab: updateCurrentTab
    })
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <span data-testid="workbench-placeholder">{`${view.rendererId} ${view.resourceId}`}</span>
    </div>
  )
}
