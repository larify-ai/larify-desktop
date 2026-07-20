import { z } from "zod"
import type { Tool, Toolkit } from "../../../shared/tool"

export const callToolInvocationSchema = (tool: Tool, name = tool.name) =>
  z.object({
    title: z.string().min(1).describe("Short user-facing phrase describing the step"),
    name: z.literal(name).describe("Tool name in toolkit_name.tool_name format"),
    args: tool.inputSchema,
  }).strict()

export const createToolRegistry = (toolkits: Toolkit[]): ToolRegistry => {
  return new ToolRegistry(toolkits)
}

export class ToolRegistry {
  private readonly toolkits = new Map<string, Toolkit>()
  private readonly qualifiedTools = new Map<string, Tool>()

  constructor(toolkits: Toolkit[]) {
    for (const toolkit of toolkits) this.addToolkit(toolkit)
  }

  private addToolkit(toolkit: Toolkit) {
    this.toolkits.set(toolkit.name, toolkit)
    for (const tool of toolkit.tools) {
      this.qualifiedTools.set(`${toolkit.name}.${tool.name}`, tool)
    }
  }

  listToolkits() {
    return [...this.toolkits.values()].map((toolkit) => ({
      toolkit_name: toolkit.name,
      description: toolkit.description,
    }))
  }

  listTools(toolkit_name: string) {
    return this.toolkits.get(toolkit_name)?.tools.map((tool) => ({
      tool_name: `${toolkit_name}.${tool.name}`,
      description: tool.description,
    }))
  }

  listToolDisplays() {
    return Object.fromEntries(
      [...this.qualifiedTools.entries()].flatMap(([name, tool]) => {
        const title = tool.metadata?.title
        const icon = tool.metadata?.icon
        if (typeof title !== "string" && typeof icon !== "string") return []
        return [[
          name,
          {
            ...(typeof title === "string" && { title }),
            ...(typeof icon === "string" && { icon }),
          },
        ]]
      }),
    )
  }

  get(tool_name: string): Tool | undefined {
    return this.resolve(tool_name)?.tool
  }

  resolve(tool_name: string): { tool_name: string; tool: Tool } | undefined {
    const tool = this.qualifiedTools.get(tool_name)
    if (!tool) return undefined
    return { tool_name, tool }
  }
}
