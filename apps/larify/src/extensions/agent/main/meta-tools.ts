import {
  asSchema,
  tool,
  type ToolSet,
  type UIMessageStreamWriter,
} from "ai"
import { z } from "zod"
import type { Tool, ToolContext } from "../../../shared/tool"
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

const TOOL_DISCOVERY_HINT = "First list tools with agent.list_toolkit_tools, then read schemas with agent.get_tool_schemas."
const toolNotFoundMessage = (name: string) => `Tool "${name}" not found. ${TOOL_DISCOVERY_HINT}`
const invalidArgumentsMessage = (details: string) => `Invalid arguments: ${details} ${TOOL_DISCOVERY_HINT}`

async function* invokeTool(
  registry: Pick<ToolRegistry, "get">,
  ctx: ToolContext,
  name: string,
  args: unknown,
  writer: UIMessageStreamWriter | undefined,
  toolCallId: string,
): AsyncIterable<unknown> {
  const found = registry.get(name)
  if (!found) {
    const error = new ToolInputError(toolNotFoundMessage(name))
    if (shouldThrowToolFailures()) throw error
    yield error.message
    return
  }
  const parsed = found.inputSchema.safeParse(args)
  if (!parsed.success) {
    const error = new ToolInputError(invalidArgumentsMessage(parsed.error.message))
    if (shouldThrowToolFailures()) throw error
    yield error.message
    return
  }
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
  const listToolkitToolsTool: Tool = {
    name: "list_toolkit_tools",
    description: "List tools in toolkits before calling agent.get_tool_schemas.",
    inputSchema: z.object({
      toolkit_names: z.array(z.string()).min(1).describe("The toolkit names"),
    }).strict(),
    execute: async (args) => {
      const { toolkit_names } = listToolkitToolsTool.inputSchema.parse(args) as { toolkit_names: string[] }
      const sections = toolkit_names.map((toolkit) => {
        const tools = registry.listTools(toolkit)
        if (!tools) throw new ToolInputError(`Toolkit "${toolkit}" not found.`)
        return {
          toolkit_name: toolkit,
          tools: tools.map((tool) => ({
            tool_name: tool.tool_name,
            description: tool.description,
          })),
        }
      })
      return JSON.stringify({ toolkits: sections })
    },
  }
  const getToolSchemasTool: Tool = {
    name: "get_tool_schemas",
    description: "Get tool schemas before invoking with call_tool wrapper.",
    inputSchema: z.object({
      tool_names: z.array(z.string()).min(1).describe("Tool names in toolkit_name.tool_name format"),
    }).strict(),
    execute: async (args) => {
      const { tool_names } = getToolSchemasTool.inputSchema.parse(args) as { tool_names: string[] }
      const definitions = tool_names.map((name) => {
        const resolved = registry.resolve(name)
        if (!resolved) throw new ToolInputError(toolNotFoundMessage(name))
        return {
          name: "call_tool",
          description: `Invoke ${resolved.tool_name} with args matching its schema.`,
          parameters: asSchema(callToolInvocationSchema(resolved.tool, resolved.tool_name)).jsonSchema,
        }
      })
      return JSON.stringify(definitions)
    },
  }
  const metaRegistry: Pick<ToolRegistry, "get"> = {
    get: (name: string) => {
      if (name === `agent.${listToolkitToolsTool.name}`) return listToolkitToolsTool
      if (name === `agent.${getToolSchemasTool.name}`) return getToolSchemasTool
      return registry.get(name)
    },
  }
  const tools: ToolSet = {
    call_tool: tool({
      description: "Invoke a tool with args matching its schema with call_tool wrapper.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short user-facing phrase describing the step"),
        name: z.string().describe("Tool name in toolkit_name.tool_name format"),
        args: z.unknown().describe("Tool args matching the tool's schema"),
      }).strict(),
      execute: async function* ({ name, args }, { toolCallId }) {
        yield* invokeTool(metaRegistry, ctx, name, args, writer, toolCallId)
      },
    }),
  }
  return tools
}
