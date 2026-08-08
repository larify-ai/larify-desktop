import type { Tool } from 'ai'
import { z } from 'zod'

export const toolName = (plugin: string, tool: string): string => `${plugin}_${tool}`

export function wrapTool(tool: Tool): Tool {
  const execute = tool.execute
  if (!(tool.inputSchema instanceof z.ZodObject)) {
    throw new Error('Tool input schema must be a Zod object.')
  }
  if ('_title' in tool.inputSchema.shape) {
    throw new Error('Tool input schema must not define the reserved "_title" field.')
  }

  return {
    ...tool,
    inputSchema: tool.inputSchema
      .extend({
        _title: z
          .string()
          .trim()
          .min(1)
          .describe('Short user-facing phrase describing the step, required')
      })
      .strict(),
    execute:
      execute &&
      ((input: Record<string, unknown>, options: Parameters<NonNullable<Tool['execute']>>[1]) => {
        const args = { ...input }
        delete args._title
        return execute(args, options)
      })
  } as Tool
}
