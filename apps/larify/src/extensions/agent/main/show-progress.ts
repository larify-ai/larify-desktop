import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'

export const showProgressTool = defineTool({
  description: 'Must show TODO title before each milestone phase, required.',
  metadata: { eager: true, icon: 'list-checks' },
  inputSchema: z
    .object({
      title: z.string().trim().min(1).describe('Short user-facing TODO title')
    })
    .strict(),
  execute: () => 'Progress shown.'
})
