import { type UIMessage, type UIMessageChunk } from 'ai'
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
import { createVerdictTool, VERDICT_TOOL, VerdictNotAcceptedError } from './verdict'
import workflowPrompt from './prompt.md?raw'

const MAX_VERDICT_ATTEMPTS = 3

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
    modelConfig: input.modelConfig,
    prompt: workflowPrompt
  })

  try {
    const verdict = createVerdictTool(input.taskFile)
    const options = {
      ...runtime,
      tools: { ...runtime.tools, [VERDICT_TOOL]: verdict.tool },
      activeTools: [...runtime.activeTools, VERDICT_TOOL],
      stopWhen: () => verdict.result() !== undefined,
      abortSignal: input.signal
    }
    const prepareStep = contextRollover(modelContextWindows[input.modelConfig.modelId].rollover)
    let currentMessages = messages

    for (let attempt = 1; attempt <= MAX_VERDICT_ATTEMPTS; attempt++) {
      const run = await runAgentSession(
        currentMessages,
        attempt === 1 ? { ...options, prepareStep } : options,
        input.onChunk
      )
      try {
        await run.messages
      } finally {
        currentMessages = run.latest()
        await sessions.saveSession(sessionId, currentMessages, input.cwd)
      }
      if (verdict.result() !== undefined) return
      if (attempt === MAX_VERDICT_ATTEMPTS) {
        throw new VerdictNotAcceptedError(`Failed to receive an accepted ${VERDICT_TOOL} call.`)
      }

      currentMessages = [
        ...currentMessages,
        userMessage(`You MUST call ${VERDICT_TOOL} to complete the request. Call it now.`)
      ]
      await sessions.saveSession(sessionId, currentMessages, input.cwd)
    }
  } finally {
    await destroySessionResources(input.app, sessionId)
  }
}
