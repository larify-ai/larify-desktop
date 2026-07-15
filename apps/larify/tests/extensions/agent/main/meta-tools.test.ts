import { describe, it, expect } from "vitest"
import { NoSuchToolError } from "ai"
import { z } from "zod"
import { buildMetaTools, buildRepairToolCall } from "../../../../src/extensions/agent/main/meta-tools"
import { createToolRegistry, ToolRegistry } from "../../../../src/extensions/agent/main/registry"
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
  ],
}

function meta() {
  const tools = buildMetaTools(createToolRegistry([kit]), { sessionId: "test" })
  return (name: string, input: unknown) => (tools[name].execute as any)(input, {})
}

async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const value of iter) out.push(value)
  return out
}

const callTool = (name: string, args: unknown, title = "Call tool") =>
  meta()("call_tool", { title, args: { name, args } })

describe("list_tools", () => {
  it("lists a toolkit's tools as markdown bullets through call_tool", async () => {
    const result = await drain(callTool("list_tools", { group: "file" }, "List file tools"))
    expect(result).toEqual(["- **read_file** - Read a file\n- **ticker** - Emit ticks"])
  })

  it("throws on unknown toolkit", async () => {
    await expect(drain(callTool("list_tools", { group: "nope" }))).rejects.toThrow(
      'Toolkit "nope" not found',
    )
  })

  it("lists agent meta tools separately", async () => {
    const result = await drain(callTool("list_tools", { group: "agent" }, "List agent tools"))
    expect(result).toEqual([
      "- **list_tools** - List tools in a toolkit.\n- **read_tools** - Read tool schemas before invoking them.",
    ])
  })
})

describe("read_tools", () => {
  it("returns the tool schema wrapped as call_tool parameters", async () => {
    const result = await drain(callTool("read_tools", { names: ["read_file"] }, "Read tool schema"))
    const schemas = JSON.parse(result[0] as string)
    const schema = schemas.read_file
    expect(schema.type).toBe("object")
    expect(schema.required).toEqual(["title", "args"])
    expect(schema.properties).toHaveProperty("title")
    expect(schema.properties.args.required).toEqual(["name", "args"])
    expect(schema.properties.args.properties.name.const).toBe("read_file")
    expect(schema.properties.args.properties.args.properties).toHaveProperty("path")
  })

  it("throws on unknown tool", async () => {
    await expect(drain(callTool("read_tools", { names: ["nope"] }))).rejects.toThrow(
      'Tool "nope" not found',
    )
  })

  it("returns multiple tool schemas at once", async () => {
    const result = await drain(callTool("read_tools", { names: ["read_file", "ticker"] }, "Read tool schemas"))
    const schemas = JSON.parse(result[0] as string)
    expect(Object.keys(schemas)).toEqual(["read_file", "ticker"])
    expect(schemas.read_file.properties.args.properties.name.const).toBe("read_file")
    expect(schemas.ticker.properties.args.properties.name.const).toBe("ticker")
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
})

describe("eager tools", () => {
  it("exposes non-lazy tools as top-level shortcuts with call_tool-shaped input", async () => {
    const out = await drain(
      meta()("read_file", {
        title: "Read a file",
        args: { name: "read_file", args: { path: "a.txt" } },
      }),
    )
    expect(out).toEqual(["content:a.txt"])
  })
})

describe("ToolRegistry", () => {
  it("exposes meta tools as the agent toolkit", () => {
    expect(createToolRegistry([kit]).listKits()).toEqual([
      { name: "agent", description: "List tools and read tool schemas." },
      { name: "file", description: "File operations" },
    ])
  })

  it("lists display metadata without exposing executable tool fields", () => {
    expect(createToolRegistry([kit]).listToolDisplays()).toEqual({
      list_tools: { icon: "search" },
      read_tools: { icon: "search" },
      read_file: { title: "Read file", icon: "read", defaultOpen: true, hideRawDetails: true },
    })
  })
})

describe("buildRepairToolCall", () => {
  const repair = buildRepairToolCall(new ToolRegistry([kit]))
  const invoke = (toolName: string, input: string, error: unknown) =>
    repair({
      toolCall: { type: "tool-call", toolCallId: "c1", toolName, input },
      error,
    } as Parameters<typeof repair>[0])

  it("rewrites a direct call to a registered tool into a call_tool call", async () => {
    const result = await invoke(
      "read_file",
      '{"path":"a.txt"}',
      new NoSuchToolError({ toolName: "read_file" }),
    )
    expect(result).toMatchObject({ toolCallId: "c1", toolName: "call_tool" })
    expect(JSON.parse(result!.input)).toEqual({
      title: "采取行动",
      args: { name: "read_file", args: { path: "a.txt" } },
    })
  })

  it("returns null when the error is not a NoSuchToolError", async () => {
    const result = await invoke("read_file", "{}", new Error("some other failure"))
    expect(result).toBeNull()
  })

  it("returns null for a tool name not in the registry", async () => {
    const result = await invoke("made_up", "{}", new NoSuchToolError({ toolName: "made_up" }))
    expect(result).toBeNull()
  })
})
