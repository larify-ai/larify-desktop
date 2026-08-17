import type { UIMessage, UIMessageChunk } from 'ai'
import type { SessionStore } from '../session'
import { saveSessionMessages } from '../session/save'
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
}

export async function runStoredAgentSession(
  sessions: SessionStore,
  request: AgentRequest
): Promise<UIMessage | undefined> {
  const { sessionId, cwd, message, options, onChunk } = request
  saveSessionMessages(sessions, sessionId, cwd, [message], request.title)
  const messages = await prepareMessages(sessions.loadMessages(sessionId))
  let latestResponse: UIMessage | undefined
  await runAgentSession(messages, options, onChunk, (response) => {
    latestResponse = response
    sessions.saveMessages(sessionId, [response])
  })
  return latestResponse
}
