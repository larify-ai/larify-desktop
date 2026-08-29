import type { AssistantSessions } from '../interaction/assistant/sessions-context'
import { workspaceName } from '../interaction/assistant/workspace'
import type { SessionAttentionState } from '../interaction/assistant/session-attention'

export interface SessionPreview {
  id: string
  name: string
  active: boolean
  attentionState: SessionAttentionState
  onClick: () => void
  onRename: (title: string) => Promise<void>
}

export interface WorkspacePreview {
  id: string
  name: string
  sessions: SessionPreview[]
  hasMore: boolean
  onCreate?: () => void
  onMore: () => Promise<void>
  onRemove?: () => void
}

export function createWorkspaces(
  source: AssistantSessions,
  options?: { hidden?: ReadonlySet<string>; onRemove?: (cwd: string) => void }
): WorkspacePreview[] {
  const onRemove = options?.onRemove
  const directory = [
    ...source.directory.filter(({ cwd }) => cwd),
    ...source.directory.filter(({ cwd }) => !cwd)
  ]
  if (
    !source.activeSession.persisted &&
    source.activeSession.cwd &&
    !directory.some(({ cwd }) => cwd === source.activeSession.cwd)
  ) {
    directory.unshift({ cwd: source.activeSession.cwd, sessions: [], hasMore: false })
  }
  return directory
    .filter((group) => !options?.hidden?.has(group.cwd))
    .map<WorkspacePreview>((group) => ({
      id: group.cwd,
      name: workspaceName(group.cwd),
      sessions: group.sessions.map((session) => ({
        id: session.id,
        name: session.title,
        active: session.id === source.activeId,
        attentionState: source.attentionState(session.id),
        onClick: () => void source.select(session.id),
        onRename: (title) => source.rename(session.id, title)
      })),
      hasMore: group.hasMore,
      onCreate:
        !source.activeSession.persisted && source.activeSession.cwd === group.cwd
          ? undefined
          : () => source.create(group.cwd),
      onMore: () => source.loadMore(group.cwd),
      onRemove: group.cwd && onRemove ? () => onRemove(group.cwd) : undefined
    }))
}
