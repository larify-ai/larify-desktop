import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'

export const scheduleTaskTool = defineTool({
  description: 'Schedule a task serially with requirement specification, acceptance criteria and related context, do not schedule in parallel.',
  metadata: { eager: true, icon: 'list-todo' },
  inputSchema: z
    .object({
      taskPath: z.string().trim().min(1).describe('Absolute path of task.md')
    })
    .strict(),
  execute: ({ taskPath }, context) => {
    if (!context.scheduleTask) throw new Error('Scheduling is unavailable.')
    context.scheduleTask(taskPath)
    return 'If you want to continue the scheduled task, please must call the agent_schedule_task tool again with another new task.md path after creating it.'
  }
})