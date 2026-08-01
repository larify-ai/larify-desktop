import { Output, type ModelMessage } from 'ai'
import { z } from 'zod'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { App } from 'kernel'
import type { Toolkit } from '../../../shared/tool'
import {
  createAgentToolkit,
  type ContextSearch
} from '../../agent/main/agent-toolkit'
import { runAgent, toolsContextFor } from '../../agent/main/agent'
import { createToolRegistry } from '../../agent/main/registry'
import { buildSystemPrompt } from '../../agent/main/system-prompt'
import { createSkillFactory, skillRoots } from '../../agent/main/skill-factory'
import { createModel } from '../../agent/main/model'
import type { AgentModelConfig } from '../../agent/shared/model'
import { read, set } from '../utils/frontmatter'
import { childTaskFiles } from '../utils/task'
import workflowPrompt from './prompt.md?raw'

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
  if (verdict.verdict === 'terminate') return

  const baseDirectory = dirname(taskFile)
  if (verdict.taskFiles.some(isAbsolute)) {
    return 'Scheduled task paths must be relative to the current task directory.'
  }
  const scheduled = verdict.taskFiles.map((path) => resolve(baseDirectory, path))
  const children = childTaskFiles(taskFile).map((path) => resolve(path))

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
  const skills = createSkillFactory(skillRoots())
  const registry = createToolRegistry(input.app.getAll<Toolkit>('tool'))
  registry.addToolkit(
    createAgentToolkit(registry, skills, input.app.get<ContextSearch>('service', 'context'))
  )
  const tools = registry.toolSet()
  const messages: ModelMessage[] = [{ role: 'user', content: input.prompt }]

  for (let attempt = 1; ; attempt++) {
    const result = runAgent({
      messages,
      tools,
      activeTools: registry.activeToolNames(),
      toolsContext: toolsContextFor(tools, {
        sessionId: input.sessionId,
        cwd: input.cwd
      }),
      abortSignal: input.signal,
      system: buildSystemPrompt(registry, input.cwd, skills, workflowPrompt),
      output: verdictOutput,
      model: createModel(input.modelConfig.modelId),
      deepseekOptions: { thinking: { type: input.modelConfig.thinking } }
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
