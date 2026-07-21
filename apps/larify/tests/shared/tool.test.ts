import { describe, it, expect } from "vitest"
import { z } from "zod"
import { defineTool, toolContextSchema } from "../../src/shared/tool"

const runOptions = (over: Record<string, unknown> = {}) => ({
  toolCallId: "call-1",
  messages: [],
  context: { sessionId: "s1", cwd: "/work" },
  ...over,
})

describe("defineTool", () => {
  it("passes validated args and a ToolRunContext (sessionId, cwd, signal) to execute", async () => {
    const seen: { args?: unknown; ctx?: unknown } = {}
    const controller = new AbortController()
    const t = defineTool({
      description: "d",
      inputSchema: z.object({ x: z.number() }),
      execute: async (args, ctx) => {
        seen.args = args
        seen.ctx = ctx
        return "ok"
      },
    })

    const out = await (t.execute as any)({ x: 1 }, runOptions({ abortSignal: controller.signal }))

    expect(out).toBe("ok")
    expect(seen.args).toEqual({ x: 1 })
    expect(seen.ctx).toEqual({ sessionId: "s1", cwd: "/work", signal: controller.signal })
  })

  it("leaves ctx.signal undefined when no abortSignal is provided", async () => {
    let signal: unknown = "unset"
    const t = defineTool({
      description: "d",
      inputSchema: z.object({}),
      execute: async (_args, ctx) => {
        signal = ctx.signal
        return ""
      },
    })

    await (t.execute as any)({}, runOptions())

    expect(signal).toBeUndefined()
  })

  it("sets contextSchema and passes inputSchema through unchanged", () => {
    const schema = z.object({ x: z.number() })
    const t = defineTool({ description: "d", inputSchema: schema, execute: async () => "" })

    expect(t.contextSchema).toBe(toolContextSchema)
    expect(t.inputSchema).toBe(schema)
  })

  it("preserves description and metadata", () => {
    const t = defineTool({
      description: "read a file",
      metadata: { icon: "read", eager: true },
      inputSchema: z.object({}),
      execute: async () => "",
    })

    expect(t.description).toBe("read a file")
    expect(t.metadata).toEqual({ icon: "read", eager: true })
  })

  it("wraps toModelOutput so it receives the raw execute output", async () => {
    const t = defineTool({
      description: "d",
      inputSchema: z.object({}),
      execute: async () => ({ summary: "did it", extra: 1 }),
      toModelOutput: (output) => ({ type: "text", value: output.summary }),
    })

    expect(t.toModelOutput).toBeTypeOf("function")
    const mo = await (t.toModelOutput as any)({ toolCallId: "c", input: {}, output: { summary: "did it", extra: 1 } })
    expect(mo).toEqual({ type: "text", value: "did it" })
  })

  it("omits toModelOutput when not configured", () => {
    const t = defineTool({ description: "d", inputSchema: z.object({}), execute: async () => "" })
    expect(t.toModelOutput).toBeUndefined()
  })
})
