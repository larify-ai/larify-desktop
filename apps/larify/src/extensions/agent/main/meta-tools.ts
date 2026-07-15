import {
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
      input: JSON.stringify({ title: "采取行动", args: { name: toolCall.toolName, args } }),
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
    call_tool: tool({
      description: "Invoke a tool with args matching its schema.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short user-facing phrase describing the specific step"),
        args: z.object({
          name: z.string().describe("The tool name"),
          args: z.unknown().describe("Arguments matching the tool's schema"),
        }),
      }),
      execute: async function* ({ args: toolInput }, { toolCallId }) {
        const { name, args } = toolInput
        yield* invokeTool(registry, ctx, name, args, writer, toolCallId)
      },
    }),
  }
  for (const found of registry.listEagerTools()) {
    tools[found.name] = tool({
      description: found.description,
      inputSchema: callToolInvocationSchema(found),
      execute: async function* ({ args: toolInput }, { toolCallId }) {
        const { name, args } = toolInput
        yield* invokeTool(registry, ctx, name, args, writer, toolCallId)
      },
    })
  }
  return tools
}
