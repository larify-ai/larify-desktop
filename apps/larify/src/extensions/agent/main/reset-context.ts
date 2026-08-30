import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'

export const resetContextTool = defineTool({
  description: 'Reset the model context and continue from the handoff.',
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
