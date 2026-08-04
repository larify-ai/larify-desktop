import { type UIMessage, type UIMessageChunk } from 'ai'
import { randomUUID } from 'node:crypto'
import type { App } from '@shared/extension'
import { runAgentSession } from '../../agent/main/run-session'
import { createAgentRuntime } from '../../agent/main/runtime'
import { createSessionStore } from '../../agent/main/session-store'
import type { AgentModelConfig } from '../../agent/shared/model'
import { larifyPath } from '../../../main/utils/app-paths'
import type { SessionResource } from '../../../main/utils/session-resource'
import { appendToList } from '../utils/frontmatter'

function userMessage(text: string): UIMessage {
  return {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }]
  }
}

async function destroySessionResources(app: App, sessionId: string): Promise<void> {
  const results = await Promise.allSettled(
    app
      .getAll<SessionResource>('session-resource')
      .map((resource) => resource.destroySession(sessionId))
  )
  for (const result of results) {
    if (result.status === 'rejected') console.error('[nest cleanup]', result.reason)
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
  const sessions = createSessionStore(larifyPath('sessions', 'background'))
  const messages = [userMessage(input.prompt)]
  await sessions.saveSession(sessionId, messages, input.cwd, [input.taskFile])
  appendToList(input.taskFile, 'sessions', sessionId)

  const runtime = createAgentRuntime({
    app: input.app,
    cwd: input.cwd,
    sessionId,
    modelConfig: input.modelConfig
  })

  try {
    const run = await runAgentSession(
      messages,
      { ...runtime, abortSignal: input.signal },
      input.onChunk
    )
    try {
      await run.messages
    } finally {
      await sessions.saveSession(sessionId, run.latest(), input.cwd)
    }
  } finally {
    await destroySessionResources(input.app, sessionId)
  }
}
