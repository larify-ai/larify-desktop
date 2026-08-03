import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { get } from '../utils/frontmatter'
import { childTaskFiles } from '../utils/task'

export const VERDICT_TOOL = 'nest_submit_verdict'
export type Verdict = 'schedule' | 'terminate'

export class VerdictNotAcceptedError extends Error {}

export interface VerdictTool {
  tool: Tool
  result: () => Verdict | undefined
}

export function createVerdictTool(taskFile: string): VerdictTool {
  let result: Verdict | undefined
  const inputSchema = z.object({
    verdict: z.enum(['schedule', 'terminate'])
  })
  const verdictTool = tool({
    description:
      'Submit the verdict immediately when requested by Review the Verdict. If rejected, correct the reported issue and submit again.',
    inputSchema,
    execute: async ({ verdict }: z.infer<typeof inputSchema>) => {
      const children = childTaskFiles(taskFile)
      const unfinished = children.filter((file) => get(file, 'status') !== 'completed')
      const scheduled = unfinished.filter((file) => get(file, 'status') === 'in_progress')

      if (verdict === 'schedule' && get(taskFile, 'status') !== 'in_progress') {
        return 'Verdict rejected: the current task must have status in_progress. Set the current task.md status to in_progress and submit again.'
      }
      if (verdict === 'schedule' && scheduled.length === 0) {
        return 'Verdict rejected: no scheduled task has status in_progress. Ensure at least one scheduled task has a task.md with status in_progress, then submit again.'
      }
      if (verdict === 'terminate' && unfinished.length > 0) {
        return `Verdict rejected: unfinished tasks remain: ${unfinished.join(', ')}. Set unfinished tasks requiring further execution to in_progress and submit schedule; otherwise set the unfinished tasks to completed and submit terminate again.`
      }
      if (verdict === 'terminate' && get(taskFile, 'status') !== 'completed') {
        return 'Verdict rejected: the current task must have status completed. Set the current task.md status to completed and submit again.'
      }

      result = verdict
      return `Verdict accepted: ${verdict}.`
    }
  })

  return {
    tool: verdictTool,
    result: () => result
  }
}
