import type { App } from 'kernel'
import type { UIMessageChunk } from 'ai'
import { get } from '../utils/frontmatter'
import { childTaskFiles } from '../utils/task'
import { exec } from './exec'
import type { AgentModelConfig } from '../../agent/shared/model'

const MAX_ATTEMPTS = 3

export interface LoopInput {
  app: App
  cwd: string
  rootTaskFile: string
  modelConfig: AgentModelConfig
  signal?: AbortSignal
  log?: (message: string) => void
  onChunk?: (chunk: UIMessageChunk) => void
}

export async function runLoop(input: LoopInput): Promise<void> {
  const log = input.log ?? (() => undefined)

  async function execute(taskFile: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await exec({
          app: input.app,
          cwd: input.cwd,
          taskFile,
          modelConfig: input.modelConfig,
          signal: input.signal,
          onChunk: input.onChunk,
          prompt: `Follow the workflow for the current task: ${taskFile}`
        })
        return
      } catch (error) {
        if (input.signal?.aborted || attempt === MAX_ATTEMPTS) throw error
      }
    }
  }

  async function runTask(taskFile: string): Promise<void> {
    while (!input.signal?.aborted && get(taskFile, 'status') !== 'completed') {
      const children = childTaskFiles(taskFile).filter(
        (file) => get(file, 'status') !== 'completed'
      )

      if (children.length > 0) {
        for (const child of children) await runTask(child)
        continue
      }

      log(`execute ${taskFile}`)
      await execute(taskFile)
      const sessions = get(taskFile, 'sessions')
      const session = Array.isArray(sessions) ? sessions.at(-1) : undefined
      log(`executed ${taskFile}${session ? ` session ${session}` : ''}`)
    }
  }

  await runTask(input.rootTaskFile)
  log('done')
}
