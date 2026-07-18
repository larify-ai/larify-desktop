import {
  asSchema,
  tool,
  type ToolSet,
  type UIMessageStreamWriter,
} from "ai"
import { z } from "zod"
import type { ToolContext } from "../../../shared/tool"
import { callToolInvocationSchema, type ToolRegistry } from "./registry"

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ToolInputError"
  }
}

function isStructured(value: unknown): value is { output: unknown; metadata: unknown } {
  return typeof value === "object" && value !== null && "output" in value && "metadata" in value
}

function formatToolFailure(error: unknown): string | null {
  if (error instanceof ToolInputError) return error.message
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return null
}

export function shouldThrowToolFailures(): boolean {
  return process.env.LARIFY_DEBUG_TOOL_ERRORS === "1"
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
  if (!found) throw new ToolInputError(`Tool "${name}" not found`)
  const parsed = found.inputSchema.safeParse(args)
  if (!parsed.success) throw new ToolInputError(`Invalid arguments: ${parsed.error.message}`)
  writer?.write({
    type: "data-tool-ready",
    id: toolCallId,
    data: { toolName: name },
  })
  try {
    const result = found.execute(parsed.data, ctx)
    if (Symbol.asyncIterator in Object(result)) {
      yield* result as AsyncIterable<unknown>
      return
    }
    const value = await result
    if (isStructured(value)) {
      writer?.write({
        type: "data-tool-meta",
        id: toolCallId,
        data: value.metadata,
      })
      yield value.output
    } else {
      yield value
    }
  } catch (error) {
    if (shouldThrowToolFailures()) throw error
    const message = formatToolFailure(error)
    if (message !== null) {
      yield message
      return
    }
    throw error
  }
}

export function buildMetaTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  writer?: UIMessageStreamWriter,
): ToolSet {
  const tools: ToolSet = {
    list_tools: tool({
      description: "List tools in one or more groups.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short user-facing phrase describing the step"),
        groups: z.array(z.string()).min(1).describe("The group names"),
      }).strict(),
      execute: async ({ groups }) => {
        const sections = groups.map((group) => {
          const tools = registry.listTools(group)
          if (!tools) throw new ToolInputError(`Group "${group}" not found`)
          const body = tools.map((tool) => `- **${tool.name}** - ${tool.description}`).join("\n")
          return { group, body }
        })
        if (sections.length === 1) return sections[0].body
        return sections.map(({ group, body }) => `## ${group}\n${body}`).join("\n\n")
      },
    }),
    read_tools: tool({
      description: "Read tool schemas before invoking them with call_tool wrapper.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short user-facing phrase describing the step"),
        tool_names: z.array(z.string()).min(1).describe("The tool names"),
      }).strict(),
      execute: async ({ tool_names }) => {
        const definitions = tool_names.map((name) => {
          const found = registry.get(name)
          if (!found) throw new ToolInputError(`Tool "${name}" not found`)
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
      }).strict(),
      execute: async function* ({ tool_name, tool_args }, { toolCallId }) {
        yield* invokeTool(registry, ctx, tool_name, tool_args, writer, toolCallId)
      },
    }),
  }
  return tools
}
