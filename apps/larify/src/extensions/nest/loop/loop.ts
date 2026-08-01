import type { App } from 'kernel'
import { get } from '../utils/frontmatter'
import { childTaskFiles } from '../utils/task'
import { exec } from './exec'
import type { AgentModelConfig } from '../../agent/shared/model'

export interface LoopInput {
  app: App
  cwd: string
  rootTaskFile: string
  sessionId: string
  modelConfig: AgentModelConfig
  signal?: AbortSignal
}

export async function runLoop(input: LoopInput): Promise<void> {
  async function runTask(taskFile: string): Promise<void> {
    while (!input.signal?.aborted && get(taskFile, 'status') !== 'completed') {
      const children = childTaskFiles(taskFile).filter(
        (file) => get(file, 'status') !== 'completed'
      )

      if (children.length > 0) {
        await Promise.all(children.map(runTask))
        continue
      }

      await exec({
        app: input.app,
        cwd: input.cwd,
        taskFile,
        sessionId: input.sessionId,
        modelConfig: input.modelConfig,
        signal: input.signal,
        prompt: `Follow the workflow for the task: ${taskFile}`
      })
    }
  }

  await runTask(input.rootTaskFile)
}
