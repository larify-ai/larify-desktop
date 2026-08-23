import { useRef, useState } from 'react'
import { FolderClosedIcon, FolderOpenIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react'
import { navigationItemClassName } from './navigation-action'
import type { WorkspacePreview } from './workspaces'
import type { SessionAttentionState } from '../interaction/assistant/session-attention'

const pageSize = 5

function SessionStatus({ state }: { state: SessionAttentionState }): React.JSX.Element | null {
  let indicator: React.JSX.Element
  if (state === 'active') {
    indicator = (
      <LoaderCircleIcon
        aria-label="执行中"
        className="size-3.5 shrink-0 animate-spin text-muted-foreground"
      />
    )
  } else if (state === 'waiting') {
    indicator = <span aria-label="等待处理" className="size-2 rounded-full bg-amber-500" />
  } else if (state === 'unread') {
    indicator = <span aria-label="有新消息" className="size-2 rounded-full bg-blue-500" />
  } else return null

  return (
    <span className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center">
      {indicator}
    </span>
  )
}

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
      <div className="group relative">
        <button
          type="button"
          aria-expanded={expanded}
          className={`${navigationItemClassName} h-8 font-medium${workspace.onCreate ? ' pr-9' : ''}`}
          onClick={toggle}
        >
          <Folder aria-hidden="true" className="size-[18px] shrink-0" />
          <span className="min-w-0 truncate">{workspace.name}</span>
        </button>
        {workspace.onCreate && (
          <button
            type="button"
            aria-label={`在 ${workspace.name} 中新建任务`}
            className="absolute top-1/2 right-3 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition-[color,background-color,opacity] hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
            onClick={workspace.onCreate}
          >
            <PlusIcon aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {expanded && (
        <div className="space-y-0.5">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              data-session-id={session.id}
              aria-current={session.active ? 'page' : undefined}
              className={`${navigationItemClassName} relative h-8 pr-9 ${session.active ? 'bg-sidebar-accent' : ''}`}
              onClick={session.onClick}
            >
              <span aria-hidden="true" />
              <span
                className="min-w-0 w-full overflow-hidden whitespace-nowrap"
                style={{
                  maskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent)'
                }}
              >
                {session.name}
              </span>
              <SessionStatus state={session.attentionState} />
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
