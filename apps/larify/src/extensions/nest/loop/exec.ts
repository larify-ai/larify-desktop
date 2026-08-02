import type { UIMessage, UIMessageChunk } from 'ai'
import { randomUUID } from 'node:crypto'
import type { App } from 'kernel'
import { runAgentSession } from '../../agent/main/run-session'
import { createAgentRuntime } from '../../agent/main/runtime'
import { createSessionStore } from '../../agent/main/session-store'
import { modelContextWindows, type AgentModelConfig } from '../../agent/shared/model'
import { larifyPath } from '../../../main/utils/app-paths'
import type { SessionResource } from '../../../main/utils/session-resource'
import { appendToList } from '../utils/frontmatter'
import { contextRollover } from './context-rollover'
import workflowPrompt from './prompt.md?raw'

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
  const messages: UIMessage[] = [
    {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: input.prompt }]
    }
  ]
  await sessions.saveSession(sessionId, messages, input.cwd, [input.taskFile])
  appendToList(input.taskFile, 'sessions', sessionId)

  const runtime = createAgentRuntime({
    app: input.app,
    cwd: input.cwd,
    sessionId,
    modelConfig: input.modelConfig,
    prompt: workflowPrompt
  })

  try {
    const run = await runAgentSession(
      messages,
      {
        ...runtime,
        abortSignal: input.signal,
        prepareStep: contextRollover(modelContextWindows[input.modelConfig.modelId].rollover)
      },
      input.onChunk
    )
    await sessions.saveSession(sessionId, await run.messages, input.cwd)
  } finally {
    await destroySessionResources(input.app, sessionId)
  }
}
