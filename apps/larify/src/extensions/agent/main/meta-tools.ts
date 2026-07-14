import {
  tool,
  asSchema,
  NoSuchToolError,
  type ToolSet,
  type UIMessageStreamWriter,
  type ToolCallRepairFunction,
} from "ai"
import { z } from "zod"
import type { ToolContext } from "../../../shared/tool"
import type { ToolRegistry } from "./registry"

function isStructured(value: unknown): value is { output: unknown; metadata?: unknown } {
  return typeof value === "object" && value !== null && "output" in value
}

export function buildRepairToolCall(registry: ToolRegistry): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, error }) => {
    if (!NoSuchToolError.isInstance(error)) return null
    if (!registry.get(toolCall.toolName)) return null
    let args: unknown
    try {
      args = JSON.parse(toolCall.input)
    } catch {
      return null
    }
    return {
      ...toolCall,
      toolName: "call_tool",
      input: JSON.stringify({ name: toolCall.toolName, args }),
    }
  }
}

export function buildMetaTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  writer?: UIMessageStreamWriter,
): ToolSet {
  return {
    list_tools: tool({
      description: "List all tools in a toolkit.",
      inputSchema: z.object({ group: z.string().describe("The toolkit name") }),
      execute: async ({ group }) => {
        const tools = registry.listTools(group)
        if (!tools) throw new Error(`Toolkit "${group}" not found`)
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
      description: "Invoke a tool with args matching its schema.",
      inputSchema: z.object({
        name: z.string().describe("The tool name"),
        args: z.unknown().describe("Arguments matching the tool's schema"),
      }),
      execute: async function* ({ name, args }, { toolCallId }) {
        const found = registry.get(name)
        if (!found) throw new Error(`Tool "${name}" not found`)
        const parsed = found.inputSchema.safeParse(args)
        if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error.message}`)
        const result = found.execute(parsed.data, ctx)
        if (Symbol.asyncIterator in Object(result)) {
          yield* result as AsyncIterable<unknown>
          return
        }
        const value = await result
        if (isStructured(value)) {
          if (value.metadata !== undefined)
            writer?.write({ type: "data-tool-meta", id: toolCallId, data: value.metadata })
          yield value.output
        } else {
          yield value
        }
      },
    }),
  }
}
