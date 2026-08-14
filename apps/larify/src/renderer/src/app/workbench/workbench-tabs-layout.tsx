import { useState, type ReactNode } from 'react'
import type { WorkbenchTab } from './workbench-tabs'
import { WorkbenchTabActionsContext } from './workbench-tab-actions'
import { WorkbenchTabs } from './workbench-tabs'

interface WorkbenchTabsLayoutProps {
  activeId: string | null
  children: ReactNode
  tabs: WorkbenchTab[]
  onClose(id: string): void
  onHome(): void
  onReorder(id: string, fromIndex: number, toIndex: number): void
  onSelect(id: string): void
}

export function WorkbenchTabsLayout({
  activeId,
  children,
  tabs,
  onClose,
  onHome,
  onReorder,
  onSelect
}: WorkbenchTabsLayoutProps): React.JSX.Element {
  const [actions, setActions] = useState<ReactNode>(null)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkbenchTabs
        actions={actions}
        activeId={activeId}
        tabs={tabs}
        onClose={onClose}
        onHome={onHome}
        onReorder={onReorder}
        onSelect={onSelect}
      />
      <WorkbenchTabActionsContext.Provider value={setActions}>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-background">{children}</div>
      </WorkbenchTabActionsContext.Provider>
    </div>
  )
}
