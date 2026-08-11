import { type UIMessage, type UIMessageChunk } from 'ai'
import { randomUUID } from 'node:crypto'
import type { App } from '../../../shared/types'
import { runStoredAgentSession } from '../../../main/core/agent'
import { createAgentRuntime } from '../../../main/core/agent/runtime'
import type { SessionStore } from '../../../main/core/session'
import type { AgentModelConfig } from '../../../main/core/model/config'
import { appendToList, get } from '../utils/frontmatter'

function userMessage(text: string): UIMessage {
  return {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }]
  }
}

export interface ExecInput {
  app: App
  cwd: string
  taskFile: string
  prompt: string
  modelConfig: AgentModelConfig
  signal?: AbortSignal
  onChunk?: (chunk: UIMessageChunk) => void
}

export async function exec(input: ExecInput): Promise<void> {
  const sessionId = randomUUID()
  const sessions = input.app.get<SessionStore>('service', 'background-session')
  if (!sessions) throw new Error('Background session service is unavailable.')
  const messages = [userMessage(input.prompt)]
  const title = String(get(input.taskFile, 'name'))
  appendToList(input.taskFile, 'sessions', sessionId)

  const runtime = createAgentRuntime({
    cwd: input.cwd,
    sessionId,
    modelConfig: input.modelConfig
  })

  await runStoredAgentSession(sessions, {
    sessionId,
    title,
    cwd: input.cwd,
    message: messages[0],
    options: { ...runtime, abortSignal: input.signal },
    onChunk: input.onChunk
  })
}
