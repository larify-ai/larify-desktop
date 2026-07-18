import { describe, it, expect } from "vitest"
import { z } from "zod"
import { buildMetaTools } from "../../../../src/extensions/agent/main/meta-tools"
import { createToolRegistry } from "../../../../src/extensions/agent/main/registry"
import type { Toolkit } from "../../../../src/shared/tool"

const kit: Toolkit = {
  name: "file",
  description: "File operations",
  tools: [
    {
      name: "read_file",
      description: "Read a file",
      metadata: { title: "Read file", icon: "read", defaultOpen: true, hideRawDetails: true, lazy: false },
      inputSchema: z.object({ path: z.string() }),
      execute: async (args) => `content:${(args as { path: string }).path}`,
    },
    {
      name: "ticker",
      description: "Emit ticks",
      inputSchema: z.object({ n: z.number() }),
      execute: async function* (args) {
        for (let i = 1; i <= (args as { n: number }).n; i++) yield `tick${i}`
      },
    },
    {
      name: "fails",
      description: "Fail predictably",
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error("Predictable tool failure")
      },
    },
  ],
}

function meta() {
  const tools = buildMetaTools(createToolRegistry([kit]), { sessionId: "test" })
  return (name: string, input: unknown) => {
    const found = tools[name]
    if (!found) return undefined
    return (found.execute as any)(input, {})
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value
}

async function drain(iter: AsyncIterable<unknown> | Promise<unknown>): Promise<unknown[]> {
  if (!isAsyncIterable(iter)) return [await iter]
  const out: unknown[] = []
  for await (const value of iter) out.push(value)
  return out
}

const callTool = (name: string, args: unknown, title = "Call tool") =>
  meta()("call_tool", { title, tool_name: name, tool_args: args })

const metaTool = (name: string, input: unknown) =>
  meta()(name, input) as AsyncIterable<unknown> | Promise<unknown>

describe("list_tools", () => {
  it("lists a group's tools as markdown bullets through call_tool", async () => {
    const result = await drain(metaTool("list_tools", { title: "List file tools", group: "file" }))
    expect(result).toEqual([
      "- **read_file** - Read a file\n- **ticker** - Emit ticks\n- **fails** - Fail predictably",
    ])
  })

  it("throws on unknown group", async () => {
    await expect(drain(metaTool("list_tools", { title: "List tools", group: "nope" }))).rejects.toThrow(
      'Group "nope" not found',
    )
  })

  it("lists agent meta tools separately", async () => {
    await expect(drain(metaTool("list_tools", { title: "List agent tools", group: "agent" }))).rejects.toThrow(
      'Group "agent" not found',
    )
  })
})

describe("read_tools", () => {
  it("returns the tool schema wrapped as call_tool parameters", async () => {
    const result = await drain(metaTool("read_tools", { title: "Read tool schema", tool_names: ["read_file"] }))
    const schemas = JSON.parse(result[0] as string)
    const schema = schemas[0]
    expect(schema.name).toBe("call_tool")
    expect(schema.parameters.type).toBe("object")
    expect(schema.parameters.required).toEqual(["title", "tool_name", "tool_args"])
    expect(schema.parameters.properties).toHaveProperty("title")
    expect(schema.parameters.properties.tool_name.const).toBe("read_file")
    expect(schema.parameters.properties.tool_args.properties).toHaveProperty("path")
  })

  it("throws on unknown tool", async () => {
    await expect(drain(metaTool("read_tools", { title: "Read tool", tool_names: ["nope"] }))).rejects.toThrow(
      'Tool "nope" not found',
    )
  })

  it("returns multiple tool schemas at once", async () => {
    const result = await drain(
      metaTool("read_tools", { title: "Read tool schemas", tool_names: ["read_file", "ticker"] }),
    )
    const schemas = JSON.parse(result[0] as string)
    expect(schemas.map((schema: { parameters: { properties: { tool_name: { const: string } } } }) =>
      schema.parameters.properties.tool_name.const,
    )).toEqual(["read_file", "ticker"])
  })
})

describe("call_tool", () => {
  it("runs a normal tool and yields its result", async () => {
    const out = await drain(callTool("read_file", { path: "a.txt" }, "Read a file"))
    expect(out).toEqual(["content:a.txt"])
  })

  it("passes a streaming tool's chunks through", async () => {
    const out = await drain(callTool("ticker", { n: 3 }, "Run ticker"))
    expect(out).toEqual(["tick1", "tick2", "tick3"])
  })

  it("throws on unknown tool", async () => {
    await expect(drain(callTool("nope", {}))).rejects.toThrow('Tool "nope" not found')
  })

  it("throws on schema-invalid args", async () => {
    await expect(drain(callTool("read_file", { path: 123 }, "Read a file"))).rejects.toThrow(
      "Invalid arguments",
    )
  })

  it("returns execution failures as tool output", async () => {
    await expect(drain(callTool("fails", {}, "Run failing tool"))).resolves.toEqual([
      "Predictable tool failure",
    ])
  })

  it("throws execution failures when debug tool errors is enabled", async () => {
    const previous = process.env.LARIFY_DEBUG_TOOL_ERRORS
    process.env.LARIFY_DEBUG_TOOL_ERRORS = "1"
    try {
      await expect(drain(callTool("fails", {}, "Run failing tool"))).rejects.toThrow("Predictable tool failure")
    } finally {
      if (previous === undefined) {
        delete process.env.LARIFY_DEBUG_TOOL_ERRORS
      } else {
        process.env.LARIFY_DEBUG_TOOL_ERRORS = previous
      }
    }
  })
})

describe("eager tools", () => {
  it("does not expose normal tools as top-level shortcuts", () => {
    expect(meta()("read_file", { title: "Read a file", tool_args: { path: "a.txt" } })).toBeUndefined()
  })
})

describe("ToolRegistry", () => {
  it("lists registered toolkits", () => {
    expect(createToolRegistry([kit]).listKits()).toEqual([{ name: "file", description: "File operations" }])
  })

  it("lists display metadata without exposing executable tool fields", () => {
    expect(createToolRegistry([kit]).listToolDisplays()).toEqual({
      read_file: { title: "Read file", icon: "read" },
    })
  })
})
