import {
  asSchema,
  tool,
  NoSuchToolError,
  type ToolSet,
  type UIMessageStreamWriter,
  type ToolCallRepairFunction,
} from "ai"
import { z } from "zod"
import type { ToolContext } from "../../../shared/tool"
import { callToolInvocationSchema, type ToolRegistry } from "./registry"

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
      input: JSON.stringify({
        title: "采取行动",
        tool_name: toolCall.toolName,
        tool_args: args,
      }),
    }
  }
}

async function* invokeTool(
  registry: ToolRegistry,
  ctx: ToolContext,
  name: string,
  args: unknown,
  writer: UIMessageStreamWriter | undefined,
  toolCallId: string,
): AsyncIterable<unknown> {
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
      writer?.write({
        type: "data-tool-meta",
        id: toolCallId,
        data: value.metadata,
      })
    yield value.output
  } else {
    yield value
  }
}

export function buildMetaTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  writer?: UIMessageStreamWriter,
): ToolSet {
  const tools: ToolSet = {
    list_tools: tool({
      description: "List tools in a toolkit.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short user-facing phrase describing the step"),
        toolkit_name: z.string().describe("The toolkit name"),
      }),
      execute: async ({ toolkit_name }) => {
        const tools = registry.listTools(toolkit_name)
        if (!tools) throw new Error(`Toolkit "${toolkit_name}" not found`)
        return tools.map((tool) => `- **${tool.name}** - ${tool.description}`).join("\n")
      },
    }),
    read_tools: tool({
      description: "Read tool schemas before invoking them with call_tool wrapper.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short user-facing phrase describing the step"),
        tool_names: z.array(z.string()).min(1).describe("The tool names"),
      }),
      execute: async ({ tool_names }) => {
        const definitions = tool_names.map((name) => {
          const found = registry.get(name)
          if (!found) throw new Error(`Tool "${name}" not found`)
          return {
            name: "call_tool",
            description: `Invoke ${found.name} with args matching its schema.`,
            parameters: asSchema(callToolInvocationSchema(found)).jsonSchema,
          }
        })
        return JSON.stringify(definitions)
      },
    }),
    call_tool: tool({
      description: "Invoke a tool with args matching its schema with call_tool wrapper.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short user-facing phrase describing the step"),
        tool_name: z.string().describe("The tool name"),
        tool_args: z.unknown().describe("Arguments matching the tool's schema"),
      }),
      execute: async function* ({ tool_name, tool_args }, { toolCallId }) {
        yield* invokeTool(registry, ctx, tool_name, tool_args, writer, toolCallId)
      },
    }),
  }
  return tools
}
