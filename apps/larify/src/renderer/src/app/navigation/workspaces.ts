import type { AssistantSessions } from '../interaction/assistant/sessions-context'
import { workspaceName } from '../interaction/assistant/workspace'

export interface SessionPreview {
  id: string
  name: string
  active?: boolean
  onClick?: () => void
}

export interface WorkspacePreview {
  id: string
  name: string
  sessions: SessionPreview[]
  hasMore?: boolean
  onMore?: () => Promise<void>
}

export function createWorkspaces(source: AssistantSessions): WorkspacePreview[] {
  const openSessions = new Set(source.sessions.map(({ id }) => id))
  const directory = [
    ...source.directory.filter(({ cwd }) => cwd),
    ...source.directory.filter(({ cwd }) => !cwd)
  ]
  return directory.map<WorkspacePreview>((group) => ({
    id: group.cwd,
    name: workspaceName(group.cwd),
    sessions: group.sessions.map((session) => {
      return {
        id: session.id,
        name: session.title,
        active: session.id === source.activeId,
        ...(openSessions.has(session.id) ? { onClick: () => source.select(session.id) } : {})
      }
    }),
    hasMore: group.hasMore,
    onMore: () => source.loadMore(group.cwd)
  }))
}
