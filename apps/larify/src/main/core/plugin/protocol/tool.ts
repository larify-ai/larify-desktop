import type { Tool as AiTool, ToolExecutionOptions } from 'ai'
import { z } from 'zod'
import type { Metadata } from './metadata'

export type Tool = AiTool

export interface FileMutation {
  path: string
  before: string | null
  after: string
}

export type TrackFileChange = (mutation: FileMutation) => void

export function wrapTool(tool: Tool): Tool {
  const execute = tool.execute
  if (!(tool.inputSchema instanceof z.ZodObject)) {
    throw new Error('Tool input schema must be a Zod object.')
  }
  if ('toolCallTitle' in tool.inputSchema.shape) {
    throw new Error('Tool input schema must not define the reserved "toolCallTitle" field.')
  }

  return {
    ...tool,
    inputSchema: tool.inputSchema
      .extend({
        toolCallTitle: z
          .string()
          .trim()
          .min(1)
          .describe('Short user-facing phrase describing the step in Chinese, required')
      })
      .strict(),
    execute:
      execute &&
      ((input: Record<string, unknown>, options: Parameters<NonNullable<Tool['execute']>>[1]) => {
        const args = { ...input }
        delete args.toolCallTitle
        return execute(args, options)
      })
  } as Tool
}

export const toolContextSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  trackFileChange: z
    .custom<TrackFileChange>((value) => typeof value === 'function')
    .optional()
})

export type ToolContext = z.infer<typeof toolContextSchema>
export type ToolRunContext = ToolContext & { signal?: AbortSignal }

type ModelOutput = Awaited<ReturnType<NonNullable<AiTool['toModelOutput']>>>

export function defineTool<IN extends z.ZodTypeAny, OUT>(config: {
  description: string
  metadata?: Metadata
  inputSchema: IN
  outputSchema?: z.ZodType<OUT>
  execute: (args: z.infer<IN>, context: ToolRunContext) => OUT | Promise<OUT>
  toModelOutput?: (output: Awaited<OUT>) => ModelOutput
}): Tool {
  return {
    description: config.description,
    metadata: config.metadata,
    contextSchema: toolContextSchema,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: (input: z.infer<IN>, options: ToolExecutionOptions<ToolContext>) =>
      config.execute(input, { ...options.context, signal: options.abortSignal }),
    ...(config.toModelOutput && {
      toModelOutput: (options: { output: Awaited<OUT> }) => config.toModelOutput!(options.output)
    })
  } as unknown as Tool
}
