import type { z } from "zod"

export interface ToolContext {
  sessionId: string
}

export interface ToolResult {
  output: unknown
  metadata?: unknown
}

export interface Tool {
  name: string
  description: string
  inputSchema: z.ZodType
  metadata?: Record<string, unknown>
  execute(args: unknown, ctx: ToolContext): Promise<unknown> | AsyncIterable<unknown>
}

export interface Toolkit {
  name: string
  description: string
  tools: Tool[]
}
