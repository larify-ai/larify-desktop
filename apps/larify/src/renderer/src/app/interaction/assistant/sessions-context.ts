import { createContext, useContext } from 'react'
import type { ConversationHeading } from './conversation-header'

export interface AssistantSessionState {
  id: string
  heading: ConversationHeading | null
}

export interface AssistantSessions {
  sessions: AssistantSessionState[]
  activeId: string
  activeSession: AssistantSessionState
  create(): void
  select(id: string): void
  setHeading(id: string, heading: ConversationHeading | null): void
}

export const AssistantSessionsContext = createContext<AssistantSessions | null>(null)

export function useAssistantSessions(): AssistantSessions {
  const sessions = useContext(AssistantSessionsContext)
  if (!sessions) throw new Error('AssistantSessionsProvider is missing.')
  return sessions
}
