import { createContext, useContext } from 'react'
import { isToolUIPart, type ChatStatus, type UIMessage } from 'ai'
import { pendingAskUserIndex } from './message-render-items'

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
    (latest.parts.some(
      (part) => isToolUIPart(part) && part.state === 'approval-requested'
    ) ||
      // 与 message-render-items 同口径：只在最后一个 step-start 之后找可见的待回答 ask_user，
      // 避免隐藏(raw)/历史 step 的 ask_user 误点亮黄点。
      pendingAskUserIndex(latest) >= 0)

  if (waiting) return 'waiting'
  if (status === 'submitted' || status === 'streaming') return 'active'
  return 'idle'
}
