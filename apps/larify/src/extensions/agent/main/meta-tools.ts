import { tool, asSchema, type ToolSet } from "ai"
import { z } from "zod"
import type { ToolRegistry } from "./registry"

export function buildMetaTools(registry: ToolRegistry): ToolSet {
  return {
    list_tools: tool({
      description: "List all tools in a toolkit.",
      inputSchema: z.object({ name: z.string().describe("The toolkit name") }),
      execute: async ({ name }) => {
        const tools = registry.listTools(name)
        if (!tools) throw new Error(`Toolkit "${name}" not found`)
        return tools.map((t) => `- **${t.name}** — ${t.description}`).join("\n")
      },
    }),
    read_tool: tool({
      description: "Read a tool's parameter schema before invoking it.",
      inputSchema: z.object({ name: z.string().describe("The tool name") }),
      execute: async ({ name }) => {
        const found = registry.get(name)
        if (!found) throw new Error(`Tool "${name}" not found`)
        return JSON.stringify(asSchema(found.inputSchema).jsonSchema)
      },
    }),
    call_tool: tool({
      description: "Invoke a tool with JSON args matching its schema.",
      inputSchema: z.object({
        name: z.string().describe("The tool name"),
        args: z.string().describe("Arguments as a JSON string"),
      }),
      execute: async function* ({ name, args }) {
        const found = registry.get(name)
        if (!found) throw new Error(`Tool "${name}" not found`)
        let raw: unknown
        try {
          raw = JSON.parse(args)
        } catch (e) {
          throw new Error(`Invalid JSON args: ${String(e)}`)
        }
        const parsed = found.inputSchema.safeParse(raw)
        if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error.message}`)
        const output = found.execute(parsed.data)
        if (Symbol.asyncIterator in Object(output)) {
          yield* output as AsyncIterable<unknown>
        } else {
          yield await output
        }
      },
    }),
  }
}
