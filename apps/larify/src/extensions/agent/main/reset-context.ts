import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'

export const resetContextTool = defineTool({
  description:
    'When the accumulated context becomes too large, first update the task and memory representations in Chinese following the `task-representation` and `memory-representation` skills to help prevent context loss, and then call the tool with a Markdown handoff linking to the relevant task and memory files to reset the model context.',
  metadata: { eager: true, icon: 'list-restart' },
  inputSchema: z
    .object({
      handoff: z
        .string()
        .trim()
        .min(1)
        .describe('Markdown handoff linking to the relevant task and memory files')
    })
    .strict(),
  execute: ({ handoff }, context) => {
    if (!context.requestContextReset) throw new Error('Context reset is unavailable.')
    context.requestContextReset(handoff)
    return 'Context reset requested.'
  }
})
