import { z } from "zod"
import type { Tool } from "ai"
import type { Toolkit } from "../../../shared/tool"

const qualify = (toolkit: string, tool: string): string => `${toolkit}_${tool}`

export function wrapWithTitle(tool: Tool): Tool {
  const execute = tool.execute
  return {
    ...tool,
    inputSchema: z
      .object({
        title: z.string().min(1).describe("Short user-facing phrase describing the step"),
        args: tool.inputSchema as z.ZodTypeAny,
      })
      .strict(),
    execute: execute && ((input: { args: unknown }, options: any) => execute(input.args, options)),
  } as Tool
}

export const createToolRegistry = (toolkits: Toolkit[]): ToolRegistry => new ToolRegistry(toolkits)

export class ToolRegistry {
  private readonly toolkits = new Map<string, Toolkit>()
  private readonly tools = new Map<string, Tool>()

  constructor(toolkits: Toolkit[]) {
    for (const toolkit of toolkits) this.addToolkit(toolkit)
  }

  addToolkit(toolkit: Toolkit) {
    this.toolkits.set(toolkit.name, toolkit)
    for (const [name, tool] of Object.entries(toolkit.tools)) {
      this.tools.set(qualify(toolkit.name, name), wrapWithTitle(tool))
    }
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

  listToolkits() {
    return [...this.toolkits.values()].map((toolkit) => ({
      toolkit_name: toolkit.name,
      description: toolkit.description,
    }))
  }

  listTools(toolkit_name: string) {
    const toolkit = this.toolkits.get(toolkit_name)
    if (!toolkit) return undefined
    const tools = Object.entries(toolkit.tools).map(([name, tool]) => ({
      tool_name: qualify(toolkit_name, name),
      ...(tool.description ? { description: tool.description } : {}),
    }))
    return {
      ...(toolkit.instruction ? { instruction: toolkit.instruction } : {}),
      tools,
    }
  }
}
