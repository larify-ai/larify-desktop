import { createContext, useContext } from 'react'
import type { UIMessage } from 'ai'
import type { ConversationHeading } from './conversation-header'
import type { SessionDirectoryGroup } from './session-directory'

export interface AssistantSessionState {
  id: string
  heading: ConversationHeading | null
  persisted: boolean
  messages: UIMessage[]
  hasMore: boolean
}

export interface AssistantSessions {
  sessions: AssistantSessionState[]
  directory: SessionDirectoryGroup[]
  activeId: string
  activeSession: AssistantSessionState
  create(): void
  select(id: string): Promise<void>
  loadMore(cwd: string): Promise<void>
  refresh(): Promise<void>
  setPersisted(id: string): void
  setHeading(id: string, heading: ConversationHeading | null): void
}

export const AssistantSessionsContext = createContext<AssistantSessions | null>(null)

export function useAssistantSessions(): AssistantSessions {
  const sessions = useContext(AssistantSessionsContext)
  if (!sessions) throw new Error('AssistantSessionsProvider is missing.')
  return sessions
}
