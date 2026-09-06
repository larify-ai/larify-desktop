import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'

export const showProgressTool = defineTool({
  description: 'Must show TODO to the user before each small step, required.',
  metadata: { eager: true, icon: 'list-checks' },
  inputSchema: z
    .object({
      title: z.string().trim().min(1).describe('Short user-facing TODO description')
    })
    .strict(),
  execute: () => 'Progress shown.'
})
