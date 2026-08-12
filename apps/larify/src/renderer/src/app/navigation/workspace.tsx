import { useRef, useState } from 'react'
import { FolderClosedIcon, FolderOpenIcon } from 'lucide-react'
import { navigationItemClassName } from './navigation-action'
import type { WorkspacePreview } from './workspaces'

const pageSize = 5

export function Workspace({ workspace }: { workspace: WorkspacePreview }): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const Folder = expanded ? FolderOpenIcon : FolderClosedIcon
  const sessions = workspace.sessions.slice(0, visibleCount)

  const toggle = (): void => {
    if (expanded) setVisibleCount(pageSize)
    setExpanded(!expanded)
  }

  const showMore = async (): Promise<void> => {
    if (loadingRef.current) return
    if (visibleCount < workspace.sessions.length) {
      setVisibleCount((count) => count + pageSize)
      return
    }
    if (!workspace.hasMore) return

    loadingRef.current = true
    setLoading(true)
    try {
      await workspace.onMore()
      setVisibleCount((count) => count + pageSize)
    } catch {
      // Keep the page available for retry.
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  return (
    <section className="space-y-0.5">
      <button
        type="button"
        aria-expanded={expanded}
        className={`${navigationItemClassName} h-8 font-medium`}
        onClick={toggle}
      >
        <Folder aria-hidden="true" className="size-[18px] shrink-0" />
        <span className="min-w-0 truncate">{workspace.name}</span>
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              data-session-id={session.id}
              aria-current={session.active ? 'page' : undefined}
              className={`${navigationItemClassName} h-8 ${session.active ? 'bg-sidebar-accent' : ''}`}
              onClick={session.onClick}
            >
              <span aria-hidden="true" />
              <span className="min-w-0 truncate">{session.name}</span>
            </button>
          ))}
          {(visibleCount < workspace.sessions.length || workspace.hasMore) && (
            <button
              type="button"
              disabled={loading}
              className={`${navigationItemClassName} h-8 text-muted-foreground`}
              onClick={() => void showMore()}
            >
              <span aria-hidden="true" />
              <span>更多</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}
