import type { Tool } from "ai"
import { z } from "zod"
import type { Toolkit } from "../../../shared/tool"

const qualify = (toolkit: string, tool: string): string => `${toolkit}_${tool}`

export function wrapWithTitle(tool: Tool): Tool {
  const execute = tool.execute
  if (!(tool.inputSchema instanceof z.ZodObject)) {
    throw new Error("Tool input schema must be a Zod object.")
  }
  if ("_title" in tool.inputSchema.shape) {
    throw new Error('Tool input schema must not define the reserved "_title" field.')
  }
  return {
    ...tool,
    inputSchema: tool.inputSchema
      .extend({
        _title: z
          .string()
          .min(1)
          .describe("Short user-facing phrase describing the step, as brief as possible"),
      })
      .strict(),
    execute:
      execute &&
      ((input: Record<string, unknown>, options: Parameters<NonNullable<Tool["execute"]>>[1]) => {
        const args = { ...input }
        delete args._title
        return execute(args, options)
      }),
  } as Tool
}

export const createToolRegistry = (toolkits: Toolkit[]): ToolRegistry => new ToolRegistry(toolkits)

export class ToolRegistry {
  private readonly toolkits = new Map<string, Toolkit>()
  private readonly tools = new Map<string, Tool>()

  constructor(toolkits: Toolkit[]) {
    for (const toolkit of toolkits) this.addToolkit(toolkit)
  }

  addToolkit(toolkit: Toolkit): void {
    const prefix = `${toolkit.name}_`
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix)) this.tools.delete(name)
    }
    const validTools: Toolkit["tools"] = {}
    for (const [name, tool] of Object.entries(toolkit.tools)) {
      const qualifiedName = qualify(toolkit.name, name)
      try {
        this.tools.set(qualifiedName, wrapWithTitle(tool))
        validTools[name] = tool
      } catch (error) {
        console.warn(
          `[agent tools] Skipped invalid tool "${qualifiedName}": ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (Object.keys(validTools).length === 0) {
      this.toolkits.delete(toolkit.name)
      return
    }
    this.toolkits.set(toolkit.name, { ...toolkit, tools: validTools })
  }

  toolSet(): Record<string, Tool> {
    return Object.fromEntries(this.tools)
  }

  tool(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  activeToolNames(): string[] {
    return [...this.tools.entries()]
      .filter(([, tool]) => tool.metadata?.eager)
      .map(([name]) => name)
  }

  listToolkits(): Array<{ toolkit_name: string; description: string }> {
    return [...this.toolkits.values()].map((toolkit) => ({
      toolkit_name: toolkit.name,
      description: toolkit.description,
    }))
  }

  listTools(toolkit_name: string):
    | {
        instruction?: string
        tools: Array<{ tool_name: string; description?: string }>
      }
    | undefined {
    const toolkit = this.toolkits.get(toolkit_name)
    if (!toolkit) return undefined
    const tools = Object.entries(toolkit.tools).map(([name, tool]) => ({
      tool_name: qualify(toolkit_name, name),
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
    }))
    return {
      ...(toolkit.instruction ? { instruction: toolkit.instruction } : {}),
      tools,
    }
  }
}
