import { WorkspaceIcon } from './workspace-icon'

export function WorkspaceEmptyState(): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-(--workbench-content) text-muted-foreground">
      <WorkspaceIcon className="size-16 opacity-30" />
      <p className="mt-2 text-lg font-medium text-foreground">开始审查</p>
    </div>
  )
}
