import type { ReactNode } from "react"
import type { WorkbenchTab } from "./workbench-tabs"
import { WorkbenchTabs } from "./workbench-tabs"

interface WorkbenchTabsLayoutProps {
  children: ReactNode
  draggable?: boolean
  newLabel?: string
  tabs: WorkbenchTab[]
  onClose?(id: string): void
  onCreate?(): void
  onReorder?(id: string, fromIndex: number, toIndex: number): void
  onSelect(id: string): void
}

export function WorkbenchTabsLayout({
  children,
  draggable,
  newLabel,
  tabs,
  onClose,
  onCreate,
  onReorder,
  onSelect,
}: WorkbenchTabsLayoutProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-workbench-chrome">
      <WorkbenchTabs
        draggable={draggable}
        newLabel={newLabel}
        tabs={tabs}
        onClose={onClose}
        onCreate={onCreate}
        onReorder={onReorder}
        onSelect={onSelect}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden bg-workbench-content">{children}</div>
    </div>
  )
}
