import type { Tool as AiTool, ToolExecutionOptions } from 'ai'
import { z } from 'zod'
import type { Metadata } from './metadata'

export type Tool = AiTool

export const toolContextSchema = z.object({
  sessionId: z.string(),
  cwd: z.string()
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
