import type { App } from 'kernel'
import type { UIMessageChunk } from 'ai'
import { get } from '../utils/frontmatter'
import { childTaskFiles } from '../utils/task'
import { exec } from './exec'
import type { AgentModelConfig } from '../../agent/shared/model'
import { VerdictNotAcceptedError } from './verdict'

const MAX_ATTEMPTS = 3

export interface LoopInput {
  app: App
  cwd: string
  rootTaskFile: string
  modelConfig: AgentModelConfig
  signal?: AbortSignal
  onChunk?: (taskFile: string, chunk: UIMessageChunk) => void
}

export async function runLoop(input: LoopInput): Promise<void> {
  async function execute(taskFile: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await exec({
          app: input.app,
          cwd: input.cwd,
          taskFile,
          modelConfig: input.modelConfig,
          signal: input.signal,
          onChunk: input.onChunk && ((chunk) => input.onChunk?.(taskFile, chunk)),
          prompt: `Follow the workflow for the current task: ${taskFile}`
        })
      } catch (error) {
        if (
          input.signal?.aborted ||
          error instanceof VerdictNotAcceptedError ||
          attempt === MAX_ATTEMPTS
        ) {
          throw error
        }
      }
    }
  }

  async function runTask(taskFile: string): Promise<void> {
    while (!input.signal?.aborted && get(taskFile, 'status') !== 'completed') {
      const children = childTaskFiles(taskFile).filter(
        (file) => get(file, 'status') !== 'completed'
      )

      if (children.length > 0) {
        await Promise.all(children.map(runTask))
        continue
      }

      await execute(taskFile)
    }
  }

  await runTask(input.rootTaskFile)
}
