import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'

export const showProgressTool = defineTool({
  description: 'Show progress to the user before starting a step.',
  metadata: { eager: true, icon: 'list-checks' },
  inputSchema: z
    .object({
      title: z.string().trim().min(1).describe('Short user-facing step in Chinese')
    })
    .strict(),
  execute: () => 'Progress shown.'
})
