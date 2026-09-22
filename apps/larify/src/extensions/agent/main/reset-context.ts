import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'

export const resetContextTool = defineTool({
  description: 'Reset the model context and continue from the handoff, only if the user requests call the tool',
  metadata: { eager: true, icon: 'repeat' },
  inputSchema: z
    .object({
      handoff: z
        .string()
        .trim()
        .min(1)
        .describe('Markdown handoff document with related files linked')
    })
    .strict(),
  execute: ({ handoff }, context) => {
    if (!context.requestContextReset) throw new Error('Context reset is unavailable.')
    context.requestContextReset(handoff)
    return 'Context reset requested.'
  }
})