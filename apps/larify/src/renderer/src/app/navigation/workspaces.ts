import type { AssistantSessions } from '../interaction/assistant/sessions-context'
import { workspaceName } from '../interaction/assistant/workspace'

export interface SessionPreview {
  id: string
  name: string
  active: boolean
  onClick: () => void
}

export interface WorkspacePreview {
  id: string
  name: string
  sessions: SessionPreview[]
  hasMore: boolean
  onMore: () => Promise<void>
}

export function createWorkspaces(source: AssistantSessions): WorkspacePreview[] {
  const directory = [
    ...source.directory.filter(({ cwd }) => cwd),
    ...source.directory.filter(({ cwd }) => !cwd)
  ]
  return directory.map<WorkspacePreview>((group) => ({
    id: group.cwd,
    name: workspaceName(group.cwd),
    sessions: group.sessions.map((session) => ({
      id: session.id,
      name: session.title,
      active: session.id === source.activeId,
      onClick: () => void source.select(session.id)
    })),
    hasMore: group.hasMore,
    onMore: () => source.loadMore(group.cwd)
  }))
}
