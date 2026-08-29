import { createContext, useContext } from 'react'
import type { UIMessage } from 'ai'
import type { ConversationHeading } from './conversation-header'
import type { SessionDirectoryGroup } from './session-directory'
import type { SessionAttentionState } from './session-attention'

export interface AssistantSessionState {
  cwd: string
  id: string
  heading: ConversationHeading | null
  persisted: boolean
  messages: UIMessage[]
  messageCount: number
}

export interface AssistantSessions {
  sessions: AssistantSessionState[]
  directory: SessionDirectoryGroup[]
  activeId: string
  activeSession: AssistantSessionState
  create(cwd?: string): void
  select(id: string): Promise<void>
  loadMore(cwd: string): Promise<void>
  refresh(): Promise<void>
  rename(id: string, title: string): Promise<void>
  setCwd(id: string, cwd: string): void
  setPersisted(id: string): void
  setHeading(id: string, heading: ConversationHeading | null): void
  attentionState(id: string): SessionAttentionState
}

export const AssistantSessionsContext = createContext<AssistantSessions | null>(null)

export function useAssistantSessions(): AssistantSessions {
  const sessions = useContext(AssistantSessionsContext)
  if (!sessions) throw new Error('AssistantSessionsProvider is missing.')
  return sessions
}
