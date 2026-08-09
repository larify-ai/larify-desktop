import { z } from 'zod'
import type { Tool } from '../../../main/core/plugin/protocol'

export const askUserTool: Tool = {
  description: 'Communicate proactively with the user.',
  metadata: { eager: true, icon: 'message-square-text' },
  inputSchema: z
    .object({
      message: z.string().min(1).describe('The message to communicate to the user'),
      options: z
        .array(
          z
            .object({
              label: z.string().min(1).describe('Short option label'),
              description: z.string().optional().describe('Brief explanation of the option')
            })
            .strict()
        )
        .optional()
        .describe('Choices offered to the user; do not include an "Other" option'),
      multiple: z.boolean().optional().describe('Allow selecting more than one option')
    })
    .strict()
}
