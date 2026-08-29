import { useRef, useState } from 'react'
import {
  FolderClosedIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
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
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const cancelRenameRef = useRef(false)
  const focusRenameRef = useRef(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
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

  const saveTitle = async (): Promise<void> => {
    const normalized = title.trim()
    const session = workspace.sessions.find(({ id }) => id === renamingId)
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      return
    }
    if (!session || !normalized || normalized === session.name) {
      setRenamingId(null)
      return
    }
    try {
      await session.onRename(normalized)
      setRenamingId(null)
    } catch {
      // Keep the editor open so the user can retry.
    }
  }

  const heading = (
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
  )

  return (
    <section className="space-y-0.5" data-workspace-id={workspace.id}>
      {workspace.onRemove ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{heading}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={workspace.onRemove}
            >
              <Trash2Icon className="size-4" />
              移除工作空间
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        heading
      )}
      {expanded && (
        <div className="space-y-0.5">
          {sessions.map((session) => (
            <ContextMenu key={session.id}>
              <ContextMenuTrigger asChild>
                {renamingId === session.id ? (
                  <div
                    data-session-id={session.id}
                    className={`${navigationItemClassName} relative h-8 pr-2 ${session.active ? 'bg-sidebar-accent' : ''}`}
                  >
                    <span aria-hidden="true" />
                    <input
                      ref={renameInputRef}
                      autoFocus
                      aria-label="任务名称"
                      className="h-6 min-w-0 w-full rounded-md border border-ring bg-sidebar px-1.5 text-sm leading-6 text-foreground outline-none"
                      maxLength={200}
                      value={title}
                      onBlur={() => void saveTitle()}
                      onChange={(event) => setTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelRenameRef.current = true
                          setRenamingId(null)
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    data-session-id={session.id}
                    aria-current={session.active ? 'page' : undefined}
                    className={`${navigationItemClassName} relative h-8 pr-5 ${session.active ? 'bg-sidebar-accent' : ''}`}
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
                )}
              </ContextMenuTrigger>
              <ContextMenuContent
                onCloseAutoFocus={(event) => {
                  if (!focusRenameRef.current) return
                  focusRenameRef.current = false
                  event.preventDefault()
                  requestAnimationFrame(() => {
                    const input = renameInputRef.current
                    if (!input) return
                    input.focus()
                    const end = input.value.length
                    input.setSelectionRange(end, end)
                  })
                }}
              >
                <ContextMenuItem
                  onSelect={() => {
                    cancelRenameRef.current = false
                    focusRenameRef.current = true
                    setTitle(session.name)
                    setRenamingId(session.id)
                  }}
                >
                  <PencilIcon className="size-4" />
                  重命名任务
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
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
