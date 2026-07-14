import { describe, it, expect } from "vitest"
import { NoSuchToolError } from "ai"
import { z } from "zod"
import { buildMetaTools, buildRepairToolCall } from "../../../../src/extensions/agent/main/meta-tools"
import { ToolRegistry } from "../../../../src/extensions/agent/main/registry"
import type { Toolkit } from "../../../../src/shared/tool"

const kit: Toolkit = {
  name: "file",
  description: "File operations",
  tools: [
    {
      name: "read_file",
      description: "Read a file",
      metadata: { title: "读取文件", icon: "read", defaultOpen: true, hideRawDetails: true },
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
  const tools = buildMetaTools(new ToolRegistry([kit]), { sessionId: "test" })
  return (name: string, input: unknown) => (tools[name].execute as any)(input, {})
}

async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const value of iter) out.push(value)
  return out
}

describe("list_tools", () => {
  it("lists a toolkit's tools as markdown bullets", async () => {
    const result = await meta()("list_tools", { group: "file" })
    expect(result).toBe("- **read_file** - Read a file\n- **ticker** - Emit ticks")
  })

  it("throws on unknown toolkit", async () => {
    await expect(meta()("list_tools", { group: "nope" })).rejects.toThrow('Toolkit "nope" not found')
  })
})

describe("read_tool", () => {
  it("returns the tool's JSON schema", async () => {
    const result = await meta()("read_tool", { name: "read_file" })
    const schema = JSON.parse(result as string)
    expect(schema.type).toBe("object")
    expect(schema.properties).toHaveProperty("path")
  })

  it("throws on unknown tool", async () => {
    await expect(meta()("read_tool", { name: "nope" })).rejects.toThrow('Tool "nope" not found')
  })
})

describe("call_tool", () => {
  it("runs a normal tool and yields its result", async () => {
    const out = await drain(meta()("call_tool", { name: "read_file", args: { path: "a.txt" } }))
    expect(out).toEqual(["content:a.txt"])
  })

  it("passes a streaming tool's chunks through", async () => {
    const out = await drain(meta()("call_tool", { name: "ticker", args: { n: 3 } }))
    expect(out).toEqual(["tick1", "tick2", "tick3"])
  })

  it("throws on unknown tool", async () => {
    await expect(drain(meta()("call_tool", { name: "nope", args: {} }))).rejects.toThrow(
      'Tool "nope" not found',
    )
  })

  it("throws on schema-invalid args", async () => {
    await expect(
      drain(meta()("call_tool", { name: "read_file", args: { path: 123 } })),
    ).rejects.toThrow("Invalid arguments")
  })
})

describe("ToolRegistry", () => {
  it("lists display metadata without exposing executable tool fields", () => {
    expect(new ToolRegistry([kit]).listToolDisplays()).toEqual({
      read_file: { title: "读取文件", icon: "read", defaultOpen: true, hideRawDetails: true },
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
    expect(JSON.parse(result!.input)).toEqual({ name: "read_file", args: { path: "a.txt" } })
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
