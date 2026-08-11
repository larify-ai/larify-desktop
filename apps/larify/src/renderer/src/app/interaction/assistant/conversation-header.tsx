import { FolderIcon } from 'lucide-react'
import { workspaceName } from './workspace'

export interface ConversationHeading {
  cwd: string
  title: string
}

export function ConversationHeader({
  cwd,
  title
}: {
  cwd: string
  title: string
}): React.JSX.Element {
  return (
    <div className="flex w-full min-w-0 items-center gap-3 overflow-hidden">
      <div className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-1.5 rounded-2xl bg-muted px-2 py-1 text-sm">
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{workspaceName(cwd)}</span>
      </div>
      <span className="block min-w-0 flex-1 truncate text-sm font-medium" title={title}>
        {title}
      </span>
    </div>
  )
}
