import { type UIMessage, type UIMessageChunk } from 'ai'
import { randomUUID } from 'node:crypto'
import type { App } from '../../../shared/types'
import { runAgentSession } from '../../../main/core/agent'
import { createAgentRuntime } from '../../../main/core/agent/runtime'
import type { ExtensionHost } from '../../../main/core/extension'
import template from '../../agent/main/prompt.md?raw'
import { createMetaTools, type ContextSearch } from '../../agent/main/meta-tools'
import type { SessionStore } from '../../../main/core/session'
import type { AgentModelConfig } from '../../agent/shared/model'
import type { SessionResource } from '../../../main/utils/session-resource'
import { appendToList, get } from '../utils/frontmatter'

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
  const sessions = input.app.get<SessionStore>('service', 'session')
  if (!sessions) throw new Error('Session service is unavailable.')
  const messages = [userMessage(input.prompt)]
  const title = String(get(input.taskFile, 'name'))
  await sessions.saveSession({
    id: sessionId,
    title,
    cwd: input.cwd,
    tasks: [input.taskFile],
    messages
  })
  appendToList(input.taskFile, 'sessions', sessionId)

  const host = input.app.get<ExtensionHost>('service', 'extension-host')
  if (!host) throw new Error('Extension host is unavailable.')
  const runtime = await createAgentRuntime({
    app: input.app,
    cwd: input.cwd,
    sessionId,
    modelConfig: input.modelConfig,
    template,
    metaTools: createMetaTools(host, input.app.get<ContextSearch>('service', 'context'))
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
      await sessions.saveSession({
        id: sessionId,
        title,
        cwd: input.cwd,
        tasks: [input.taskFile],
        messages: run.latest()
      })
    }
  } finally {
    await destroySessionResources(input.app, sessionId)
  }
}
