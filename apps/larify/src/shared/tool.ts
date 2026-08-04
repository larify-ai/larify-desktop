import type { Tool, ToolExecutionOptions } from "ai"
import { z } from "zod"

export const toolContextSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
})

export type ToolContext = z.infer<typeof toolContextSchema>

export interface Toolkit {
  name: string
  description?: string
  eager?: boolean
  instruction?: string
  tools: Record<string, Tool>
}

type ModelOutput = Awaited<ReturnType<NonNullable<Tool<any, any, any>["toModelOutput"]>>>

export type ToolRunContext = ToolContext & { signal?: AbortSignal }

export function defineTool<IN extends z.ZodTypeAny, OUT>(config: {
  description: string
  metadata?: Record<string, unknown>
  inputSchema: IN
  execute: (args: z.infer<IN>, ctx: ToolRunContext) => OUT | Promise<OUT>
  toModelOutput?: (output: Awaited<OUT>) => ModelOutput
}): Tool {
  return {
    description: config.description,
    metadata: config.metadata,
    contextSchema: toolContextSchema,
    inputSchema: config.inputSchema,
    execute: (input: z.infer<IN>, options: ToolExecutionOptions<ToolContext>) =>
      config.execute(input, { ...options.context, signal: options.abortSignal }),
    ...(config.toModelOutput && {
      toModelOutput: (opts: { output: Awaited<OUT> }) => config.toModelOutput!(opts.output),
    }),
  } as unknown as Tool
}
