import { describe, it, expect } from "vitest"
import { z } from "zod"
import { buildMetaTools } from "../../../../src/extensions/agent/main/meta-tools"
import { ToolRegistry } from "../../../../src/extensions/agent/main/registry"
import type { Toolkit } from "../../../../src/shared/tool"

const kit: Toolkit = {
  name: "file",
  description: "File operations",
  tools: [
    {
      name: "read_file",
      description: "Read a file",
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
  const tools = buildMetaTools(new ToolRegistry([kit]))
  return (name: string, input: unknown) => (tools[name].execute as any)(input, {})
}

async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const value of iter) out.push(value)
  return out
}

describe("list_tools", () => {
  it("lists a toolkit's tools as markdown bullets", async () => {
    const result = await meta()("list_tools", { name: "file" })
    expect(result).toBe("- **read_file** — Read a file\n- **ticker** — Emit ticks")
  })

  it("throws on unknown toolkit", async () => {
    await expect(meta()("list_tools", { name: "nope" })).rejects.toThrow('Toolkit "nope" not found')
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

describe("invoke_tool", () => {
  it("runs a normal tool and yields its result", async () => {
    const out = await drain(meta()("invoke_tool", { name: "read_file", args: '{"path":"a.txt"}' }))
    expect(out).toEqual(["content:a.txt"])
  })

  it("passes a streaming tool's chunks through", async () => {
    const out = await drain(meta()("invoke_tool", { name: "ticker", args: '{"n":3}' }))
    expect(out).toEqual(["tick1", "tick2", "tick3"])
  })

  it("throws on unknown tool", async () => {
    await expect(drain(meta()("invoke_tool", { name: "nope", args: "{}" }))).rejects.toThrow(
      'Tool "nope" not found',
    )
  })

  it("throws on invalid JSON args", async () => {
    await expect(
      drain(meta()("invoke_tool", { name: "read_file", args: "not json" })),
    ).rejects.toThrow("Invalid JSON args")
  })

  it("throws on schema-invalid args", async () => {
    await expect(
      drain(meta()("invoke_tool", { name: "read_file", args: '{"path":123}' })),
    ).rejects.toThrow("Invalid arguments")
  })
})
