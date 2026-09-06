import { createContext, useContext } from 'react'
import { getToolName, isToolUIPart, type ChatStatus, type UIMessage } from 'ai'

export type SessionAttentionState = 'idle' | 'active' | 'waiting' | 'unread'
export type SessionAttentionReport = (
  id: string,
  state: Exclude<SessionAttentionState, 'unread'>
) => void

export const SessionAttentionContext = createContext<SessionAttentionReport | null>(null)

export function useSessionAttentionReport(): SessionAttentionReport {
  const report = useContext(SessionAttentionContext)
  if (!report) throw new Error('SessionAttentionContext.Provider is missing.')
  return report
}

export function sessionAttentionState(
  status: ChatStatus,
  messages: UIMessage[]
): Exclude<SessionAttentionState, 'unread'> {
  const latest = messages.at(-1)
  const waiting =
    latest?.role === 'assistant' &&
    latest.parts.some(
      (part) =>
        isToolUIPart(part) &&
        (part.state === 'approval-requested' ||
          (getToolName(part) === 'agent_ask_user' && part.state === 'input-available'))
    )

  if (waiting) return 'waiting'
  if (status === 'submitted' || status === 'streaming') return 'active'
  return 'idle'
}
