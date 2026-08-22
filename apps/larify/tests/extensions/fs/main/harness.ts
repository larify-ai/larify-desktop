import { tmpdir } from 'node:os'
import type { Tool } from 'ai'

let counter = 0

export const freshSession = (): string => `test-session-${++counter}`

interface CallCtx {
  sessionId?: string
  cwd?: string
  modelId?: string
  signal?: AbortSignal
}

export function callTool<T = unknown>(
  tool: Tool,
  input: Record<string, unknown>,
  ctx: CallCtx = {}
): Promise<T> {
  const schema = tool.inputSchema as unknown as { parse: (value: unknown) => unknown }
  const parsed = schema.parse(input)
  const execute = tool.execute as unknown as (i: unknown, o: unknown) => Promise<T>
  return execute(parsed, {
    toolCallId: 'test-call',
    messages: [],
    context: {
      sessionId: ctx.sessionId ?? 'test',
      cwd: ctx.cwd ?? tmpdir(),
      modelId: ctx.modelId
    },
    abortSignal: ctx.signal
  })
}
