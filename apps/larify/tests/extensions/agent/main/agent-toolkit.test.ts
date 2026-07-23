import { describe, it, expect } from "vitest"
import { tool } from "ai"
import { z } from "zod"
import { createToolRegistry } from "../../../../src/extensions/agent/main/registry"
import { createAgentToolkit } from "../../../../src/extensions/agent/main/agent-toolkit"
import type { Toolkit } from "../../../../src/shared/tool"

const fileToolkit: Toolkit = {
  name: "file",
  description: "File operations",
  instruction: "Use these for files.",
  tools: {
    read: tool({
      description: "Read a file",
      inputSchema: z.object({ path: z.string() }),
      execute: async () => "",
    }),
  },
}

function agentTools() {
  const registry = createToolRegistry([fileToolkit])
  const toolkit = createAgentToolkit(registry)
  const run = (name: "list_toolkit_tools" | "get_tool_schemas", input: unknown) =>
    (toolkit.tools[name].execute as any)(input, {})
  return { toolkit, run }
}

describe("list_toolkit_tools", () => {
  it("lists a toolkit's tools as markdown with instruction", async () => {
    const { run } = agentTools()
    const out = await run("list_toolkit_tools", { toolkit_names: ["file"] })
    expect(out).toBe(
      "## file\n\nUse these for files.\n\n- **file_read**: Read a file",
    )
  })

  it("lists multiple toolkits as separate sections; one without instruction has no instruction line", async () => {
    const barToolkit: Toolkit = {
      name: "bar",
      description: "Bar ops",
      tools: {
        run: tool({ description: "Run it", inputSchema: z.object({}), execute: async () => "" }),
        stop: tool({ description: "Stop it", inputSchema: z.object({}), execute: async () => "" }),
      },
    }
    const registry = createToolRegistry([fileToolkit, barToolkit])
    const toolkit = createAgentToolkit(registry)
    const out = await (toolkit.tools.list_toolkit_tools.execute as any)(
      { toolkit_names: ["file", "bar"] },
      {},
    )
    expect(out).toBe(
      "## file\n\nUse these for files.\n\n- **file_read**: Read a file" +
        "\n\n" +
        "## bar\n\n- **bar_run**: Run it\n- **bar_stop**: Stop it",
    )
  })

  it("throws on an unknown toolkit", async () => {
    const { run } = agentTools()
    await expect(run("list_toolkit_tools", { toolkit_names: ["nope"] })).rejects.toThrow(
      'Toolkit "nope" not found.',
    )
  })

  it("is eager", () => {
    const { toolkit } = agentTools()
    expect(toolkit.tools.list_toolkit_tools.metadata?.eager).toBe(true)
  })
})

describe("get_tool_schemas", () => {
  it("returns the tool's native { title, args } schema", async () => {
    const { run } = agentTools()
    const out = JSON.parse(await run("get_tool_schemas", { tool_names: ["file_read"] }))
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("function")
    expect(out[0].name).toBe("file_read")
    expect(out[0].description).toBe("Read a file")
    expect(out[0].inputSchema.type).toBe("object")
    expect(out[0].inputSchema.properties).toHaveProperty("title")
    expect(out[0].inputSchema.properties.args.properties).toHaveProperty("path")
  })

  it("returns multiple schemas at once", async () => {
    const { run } = agentTools()
    const out = JSON.parse(await run("get_tool_schemas", { tool_names: ["file_read", "file_read"] }))
    expect(out.map((d: { name: string }) => d.name)).toEqual(["file_read", "file_read"])
  })

  it("throws on an unknown tool", async () => {
    const { run } = agentTools()
    await expect(run("get_tool_schemas", { tool_names: ["file_nope"] })).rejects.toThrow(
      'Tool "file_nope" not found.',
    )
  })

  it("is eager", () => {
    const { toolkit } = agentTools()
    expect(toolkit.tools.get_tool_schemas.metadata?.eager).toBe(true)
  })
})
