import type { z } from "zod"

export interface Tool {
  name: string
  description: string
  inputSchema: z.ZodType
  metadata?: Record<string, unknown>
  execute(args: unknown): Promise<unknown> | AsyncIterable<unknown>
}

export interface Toolkit {
  name: string
  description: string
  tools: Tool[]
}
