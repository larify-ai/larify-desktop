import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'

export const scheduleTaskTool = defineTool({
  description: 'Must schedule a task serially with requirement specification, acceptance criteria and related context, do not schedule in parallel.',
  metadata: { eager: true, icon: 'list-todo' },
  inputSchema: z
    .object({
      taskPath: z.string().trim().min(1).describe('Absolute path of task.md')
    })
    .strict(),
  execute: ({ taskPath }, context) => {
    if (!context.scheduleTask) throw new Error('Scheduling is unavailable.')
    context.scheduleTask(taskPath)
    return 'Task completed. Please read details in the task.md file.'
  }
})