import type { UIMessage, UIMessageChunk } from 'ai'
import type { SessionStore } from '../session'
import { saveSessionMessages } from '../session/save'
import { generateSessionTitle } from '../session/title'
import type { AgentOptions } from './engine'
import { prepareMessages } from './messages'
import { runAgentSession } from './session'

export interface AgentRequest {
  sessionId: string
  title?: string
  cwd: string
  message: UIMessage
  options: AgentOptions
  onChunk?: (chunk: UIMessageChunk) => void
  onTitle?: (title: string) => void
}

export async function runStoredAgentSession(
  sessions: SessionStore,
  request: AgentRequest
): Promise<UIMessage | undefined> {
  const { sessionId, cwd, message, options, onChunk } = request
  const text = message.parts.find((part) => part.type === 'text')?.text.trim() ?? ''
  const shouldGenerateTitle =
    request.title === undefined && !sessions.hasSession(sessionId) && text.length >= 6

  saveSessionMessages(sessions, sessionId, cwd, [message], request.title)
  const titleTask = shouldGenerateTitle
    ? generateSessionTitle(text)
        .then((title) => {
          if (!title) return
          sessions.renameSession(sessionId, title)
          request.onTitle?.(title)
        })
        .catch(() => {})
    : undefined
  const messages = await prepareMessages(sessions.loadMessages(sessionId))
  let latestResponse: UIMessage | undefined
  const finalMessages = await runAgentSession(messages, options, onChunk, (response) => {
    latestResponse = response
    sessions.saveMessages(sessionId, [response])
  })
  const finalResponse = finalMessages
    .slice(messages.length)
    .findLast((candidate) => candidate.role === 'assistant')
  if (finalResponse) {
    latestResponse = finalResponse
    sessions.saveMessages(sessionId, [finalResponse])
  }
  await titleTask
  return latestResponse
}
