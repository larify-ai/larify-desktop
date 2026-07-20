import { describe, it, expect } from "vitest"
import { z } from "zod"
import { buildMetaTools } from "../../../../src/extensions/agent/main/meta-tools"
import { createToolRegistry } from "../../../../src/extensions/agent/main/registry"
import type { Toolkit } from "../../../../src/shared/tool"

const toolkit: Toolkit = {
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

const terminalToolkit: Toolkit = {
  name: "terminal",
  description: "Terminal operations",
  tools: [
    {
      name: "write_terminal",
      description: "Write terminal input",
      inputSchema: z.object({ input: z.string() }),
      execute: async () => "ok",
    },
  ],
}

function meta() {
  const tools = buildMetaTools(createToolRegistry([toolkit, terminalToolkit]), { sessionId: "test" })
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
  meta()("call_tool", { title, name, args })

const metaTool = (name: string, input: unknown) =>
  meta()(name, input) as AsyncIterable<unknown> | Promise<unknown>

describe("list_toolkit_tools", () => {
  it("lists a toolkit's tools as JSON through call_tool", async () => {
    const result = await drain(
      callTool("agent.list_toolkit_tools", { toolkit_names: ["file"] }),
    )
    expect(JSON.parse(result[0] as string)).toEqual({
      toolkits: [
        {
          toolkit_name: "file",
          tools: [
            { tool_name: "file.read_file", description: "Read a file" },
            { tool_name: "file.ticker", description: "Emit ticks" },
            { tool_name: "file.fails", description: "Fail predictably" },
          ],
        },
      ],
    })
  })

  it("lists multiple toolkits as sections", async () => {
    const result = await drain(
      callTool("agent.list_toolkit_tools", { toolkit_names: ["file", "terminal"] }),
    )
    expect(JSON.parse(result[0] as string)).toEqual({
      toolkits: [
        {
          toolkit_name: "file",
          tools: [
            { tool_name: "file.read_file", description: "Read a file" },
            { tool_name: "file.ticker", description: "Emit ticks" },
            { tool_name: "file.fails", description: "Fail predictably" },
          ],
        },
        {
          toolkit_name: "terminal",
          tools: [
            { tool_name: "terminal.write_terminal", description: "Write terminal input" },
          ],
        },
      ],
    })
  })

  it("throws on unknown toolkit", async () => {
    await expect(
      drain(callTool("agent.list_toolkit_tools", { toolkit_names: ["nope"] })),
    ).resolves.toEqual([
      'Toolkit "nope" not found',
    ])
  })

  it("lists agent meta tools separately", async () => {
    await expect(
      drain(callTool("agent.list_toolkit_tools", { toolkit_names: ["agent"] })),
    ).resolves.toEqual([
      'Toolkit "agent" not found',
    ])
  })
})

describe("get_tool_schemas", () => {
  it("returns the tool schema wrapped as call_tool parameters", async () => {
    const result = await drain(
      callTool("agent.get_tool_schemas", { tool_names: ["file.read_file"] }),
    )
    const schemas = JSON.parse(result[0] as string)
    const schema = schemas[0]
    expect(schema.name).toBe("call_tool")
    expect(schema.parameters.type).toBe("object")
    expect(schema.parameters.required).toEqual(["title", "name", "args"])
    expect(schema.parameters.properties).toHaveProperty("title")
    expect(schema.parameters.properties.name.const).toBe("file.read_file")
    expect(schema.parameters.properties.args.properties).toHaveProperty("path")
  })

  it("throws on unknown tool", async () => {
    await expect(drain(callTool("agent.get_tool_schemas", { tool_names: ["nope"] }))).resolves.toEqual([
      'Tool "nope" not found',
    ])
  })

  it("returns multiple tool schemas at once", async () => {
    const result = await drain(
      callTool("agent.get_tool_schemas", { tool_names: ["file.read_file", "file.ticker"] }),
    )
    const schemas = JSON.parse(result[0] as string)
    expect(schemas.map((schema: { parameters: { properties: { name: { const: string } } } }) =>
      schema.parameters.properties.name.const,
    )).toEqual(["file.read_file", "file.ticker"])
  })
})

describe("call_tool", () => {
  it("runs a normal tool and yields its result", async () => {
    const out = await drain(callTool("file.read_file", { path: "a.txt" }, "Read a file"))
    expect(out).toEqual(["content:a.txt"])
  })

  it("passes a streaming tool's chunks through", async () => {
    const out = await drain(callTool("file.ticker", { n: 3 }, "Run ticker"))
    expect(out).toEqual(["tick1", "tick2", "tick3"])
  })

  it("returns unknown tool errors as tool output", async () => {
    await expect(drain(callTool("nope", {}))).resolves.toEqual(['Tool "nope" not found'])
  })

  it("returns schema-invalid args as tool output", async () => {
    const out = await drain(callTool("file.read_file", { path: 123 }, "Read a file"))
    expect(out).toHaveLength(1)
    expect(out[0]).toContain("Invalid arguments")
  })

  it("returns execution failures as tool output", async () => {
    await expect(drain(callTool("file.fails", {}, "Run failing tool"))).resolves.toEqual([
      "Predictable tool failure",
    ])
  })

  it("throws execution failures when debug tool errors is enabled", async () => {
    const previous = process.env.LARIFY_DEBUG_TOOL_ERRORS
    process.env.LARIFY_DEBUG_TOOL_ERRORS = "1"
    try {
      await expect(drain(callTool("file.fails", {}, "Run failing tool"))).rejects.toThrow("Predictable tool failure")
    } finally {
      if (previous === undefined) {
        delete process.env.LARIFY_DEBUG_TOOL_ERRORS
      } else {
        process.env.LARIFY_DEBUG_TOOL_ERRORS = previous
      }
    }
  })

  it("throws input failures when debug tool errors is enabled", async () => {
    const previous = process.env.LARIFY_DEBUG_TOOL_ERRORS
    process.env.LARIFY_DEBUG_TOOL_ERRORS = "1"
    try {
      await expect(drain(callTool("file.read_file", { path: 123 }, "Read a file"))).rejects.toThrow(
        "Invalid arguments",
      )
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
  it("only exposes call_tool at the top level", () => {
    expect(meta()("file.read_file", { title: "Read a file", args: { path: "a.txt" } })).toBeUndefined()
    expect(metaTool("agent.list_toolkit_tools", { toolkit_names: ["file"] })).toBeUndefined()
    expect(metaTool("agent.get_tool_schemas", { tool_names: ["file.read_file"] })).toBeUndefined()
  })
})

describe("ToolRegistry", () => {
  it("lists registered toolkits", () => {
    expect(createToolRegistry([toolkit]).listToolkits()).toEqual([
      { toolkit_name: "file", description: "File operations" },
    ])
  })

  it("lists display metadata without exposing executable tool fields", () => {
    expect(createToolRegistry([toolkit]).listToolDisplays()).toEqual({
      "file.read_file": { title: "Read file", icon: "read" },
    })
  })
})
