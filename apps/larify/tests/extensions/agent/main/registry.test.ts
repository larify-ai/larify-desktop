import { describe, it, expect } from "vitest"
import { tool, type Tool } from "ai"
import { z } from "zod"
import { createToolRegistry, wrapWithTitle } from "../../../../src/extensions/agent/main/registry"
import { toolContextSchema, type Toolkit } from "../../../../src/shared/tool"

const parse = (schema: unknown, value: unknown) => (schema as z.ZodType).safeParse(value)

describe("wrapWithTitle", () => {
  const raw = tool({
    description: "Read a file",
    metadata: { icon: "read", eager: true },
    contextSchema: toolContextSchema,
    inputSchema: z.object({ path: z.string() }),
    execute: async (args, options) => ({ got: args, ctx: (options as { context: unknown }).context }),
  })
  const wrapped = wrapWithTitle(raw)

  it("wraps the schema as strict { title, args }", () => {
    expect(parse(wrapped.inputSchema, { title: "open", args: { path: "a.txt" } }).success).toBe(true)
  })

  it("requires a non-empty title", () => {
    expect(parse(wrapped.inputSchema, { args: { path: "a.txt" } }).success).toBe(false)
    expect(parse(wrapped.inputSchema, { title: "", args: { path: "a.txt" } }).success).toBe(false)
  })

  it("validates args against the original schema", () => {
    expect(parse(wrapped.inputSchema, { title: "t", args: { path: 123 } }).success).toBe(false)
    expect(parse(wrapped.inputSchema, { title: "t", args: {} }).success).toBe(false)
  })

  it("rejects extra top-level keys (strict)", () => {
    expect(parse(wrapped.inputSchema, { title: "t", args: { path: "a" }, name: "x" }).success).toBe(false)
  })

  it("execute strips title and forwards args + options to the original", async () => {
    const out = await (wrapped.execute as any)(
      { title: "open", args: { path: "a.txt" } },
      { context: { sessionId: "s1" } },
    )
    expect(out).toEqual({ got: { path: "a.txt" }, ctx: { sessionId: "s1" } })
  })

  it("preserves description, metadata, and the tool's own contextSchema", () => {
    expect(wrapped.description).toBe("Read a file")
    expect(wrapped.metadata).toEqual({ icon: "read", eager: true })
    expect(wrapped.contextSchema).toBe(toolContextSchema)
  })

  it("leaves execute undefined when the tool has none", () => {
    const noExec = { description: "d", inputSchema: z.object({}) } as unknown as Tool
    expect(wrapWithTitle(noExec).execute).toBeUndefined()
  })
})

const fileToolkit: Toolkit = {
  name: "file",
  description: "File operations",
  instruction: "Use these for files.",
  tools: {
    read: tool({ description: "Read", metadata: { eager: true }, contextSchema: toolContextSchema, inputSchema: z.object({ path: z.string() }), execute: async (a) => a }),
    write: tool({ description: "Write", inputSchema: z.object({ path: z.string() }), execute: async () => "ok" }),
  },
}

const browserToolkit: Toolkit = {
  name: "browser",
  description: "Browser control",
  tools: {
    navigate: tool({ inputSchema: z.object({ url: z.string() }), execute: async () => "ok" }),
  },
}

describe("ToolRegistry", () => {
  const registry = createToolRegistry([fileToolkit, browserToolkit])

  it("toolSet returns all tools keyed by qualified name, each wrapped", () => {
    const set = registry.toolSet()
    expect(Object.keys(set).sort()).toEqual(["browser_navigate", "file_read", "file_write"])
    expect(parse(set.file_read.inputSchema, { title: "t", args: { path: "a" } }).success).toBe(true)
    expect(set.file_read.contextSchema).toBe(toolContextSchema)
  })

  it("activeToolNames returns only eager tools", () => {
    expect(registry.activeToolNames()).toEqual(["file_read"])
  })

  it("listToolkits returns name + description", () => {
    expect(registry.listToolkits()).toEqual([
      { toolkit_name: "file", description: "File operations" },
      { toolkit_name: "browser", description: "Browser control" },
    ])
  })

  it("listTools includes instruction when present and description when present", () => {
    expect(registry.listTools("file")).toEqual({
      instruction: "Use these for files.",
      tools: [
        { tool_name: "file_read", description: "Read" },
        { tool_name: "file_write", description: "Write" },
      ],
    })
  })

  it("listTools omits instruction and description when absent", () => {
    expect(registry.listTools("browser")).toEqual({
      tools: [{ tool_name: "browser_navigate" }],
    })
  })

  it("listTools returns undefined for an unknown toolkit", () => {
    expect(registry.listTools("nope")).toBeUndefined()
  })

  it("toolSet tools execute through the wrapper (unwrap args, pass context)", async () => {
    const set = registry.toolSet()
    const out = await (set.file_read.execute as any)(
      { title: "read it", args: { path: "x.txt" } },
      { context: { sessionId: "sess" } },
    )
    expect(out).toEqual({ path: "x.txt" })
  })
})
