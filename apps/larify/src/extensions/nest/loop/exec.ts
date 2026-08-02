import { Output, type ModelMessage } from 'ai'
import { z } from 'zod'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { App } from 'kernel'
import { runAgent } from '../../agent/main/agent'
import { createAgentRuntime } from '../../agent/main/runtime'
import { modelContextWindows, type AgentModelConfig } from '../../agent/shared/model'
import { read, set } from '../utils/frontmatter'
import { childTaskFiles } from '../utils/task'
import workflowPrompt from './prompt.md?raw'
import { contextRollover } from './context-rollover'

const MAX_VERDICT_ATTEMPTS = 3
const taskPath = z.string().describe('Path relative to the current task directory.')
const verdictSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('schedule'),
    taskFiles: z.array(taskPath).min(1)
  }),
  z.object({
    verdict: z.literal('terminate')
  })
])
const verdictOutput = Output.object({ schema: verdictSchema })

type Verdict = z.infer<typeof verdictSchema>

function validateVerdict(taskFile: string, verdict: Verdict): string | undefined {
  const baseDirectory = dirname(taskFile)
  const taskFiles = verdict.verdict === 'schedule' ? verdict.taskFiles : []
  if (taskFiles.some(isAbsolute)) {
    return 'Scheduled task paths must be relative to the current task directory.'
  }
  const scheduled = taskFiles.map((path) => resolve(baseDirectory, path))
  const children = childTaskFiles(taskFile).map((path) => resolve(path))

  for (const path of children) {
    try {
      if (!scheduled.includes(path) && read(path).metadata.status !== 'completed') {
        return `Do not create task.md for an unscheduled task: ${path}`
      }
    } catch (error) {
      return `Failed to read child task: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (verdict.verdict === 'terminate') return

  for (const path of scheduled) {
    if (!children.includes(path)) return `Scheduled task.md does not exist: ${path}`
    try {
      const { metadata } = read(path)
      if (typeof metadata.name !== 'string' || !metadata.name.trim()) {
        return `Scheduled task must have a name: ${path}`
      }
      if (typeof metadata.description !== 'string' || !metadata.description.trim()) {
        return `Scheduled task must have a description: ${path}`
      }
    } catch (error) {
      return `Failed to read scheduled task: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return undefined
}

export interface ExecInput {
  app: App
  cwd: string
  taskFile: string
  prompt: string
  sessionId: string
  modelConfig: AgentModelConfig
  signal?: AbortSignal
}

export async function exec(input: ExecInput): Promise<'schedule' | 'terminate'> {
  const messages: ModelMessage[] = [{ role: 'user', content: input.prompt }]
  const runtime = createAgentRuntime({
    app: input.app,
    cwd: input.cwd,
    sessionId: input.sessionId,
    modelConfig: input.modelConfig,
    prompt: workflowPrompt
  })

  for (let attempt = 1; ; attempt++) {
    const result = runAgent({
      messages,
      ...runtime,
      abortSignal: input.signal,
      output: verdictOutput,
      prepareStep: contextRollover(modelContextWindows[input.modelConfig.modelId].rollover)
    })
    const verdict = await result.output
    const error = validateVerdict(input.taskFile, verdict)
    if (!error) {
      if (verdict.verdict === 'schedule') {
        for (const path of verdict.taskFiles) {
          set(resolve(dirname(input.taskFile), path), 'status', 'in_progress')
        }
      } else {
        set(input.taskFile, 'status', 'completed')
      }
      return verdict.verdict
    }
    if (attempt === MAX_VERDICT_ATTEMPTS) {
      throw new Error(
        `Failed to produce a valid verdict: ${error} Received: ${JSON.stringify(verdict)}`
      )
    }

    messages.push(...(await result.responseMessages), {
      role: 'user',
      content: `The verdict is invalid: ${error} Try again.`
    })
  }
}
