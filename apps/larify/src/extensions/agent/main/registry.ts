import { z } from "zod"
import type { Tool, Toolkit } from "../../../shared/tool"

export const callToolInvocationSchema = (tool: Tool) =>
  z.object({
    title: z.string().min(1).describe("Short user-facing phrase describing the step"),
    tool_name: z.literal(tool.name).describe("The tool name to invoke through call_tool"),
    tool_args: tool.inputSchema,
  })

export const createToolRegistry = (kits: Toolkit[]): ToolRegistry => {
  return new ToolRegistry(kits)
}

export class ToolRegistry {
  private readonly kits = new Map<string, Toolkit>()
  private readonly tools = new Map<string, Tool>()

  constructor(kits: Toolkit[]) {
    for (const kit of kits) this.addKit(kit)
  }

  private addKit(kit: Toolkit) {
    this.kits.set(kit.name, kit)
    for (const tool of kit.tools) this.tools.set(tool.name, tool)
  }

  listKits() {
    return [...this.kits.values()].map((kit) => ({ name: kit.name, description: kit.description }))
  }

  listTools(name: string) {
    return this.kits.get(name)?.tools.map((tool) => ({ name: tool.name, description: tool.description }))
  }

  listToolDisplays() {
    return Object.fromEntries(
      [...this.tools.values()].flatMap((tool) => {
        const title = tool.metadata?.title
        const icon = tool.metadata?.icon
        const defaultOpen = tool.metadata?.defaultOpen
        const hideRawDetails = tool.metadata?.hideRawDetails
        if (
          typeof title !== "string" &&
          typeof icon !== "string" &&
          typeof defaultOpen !== "boolean" &&
          typeof hideRawDetails !== "boolean"
        )
          return []
        return [[
          tool.name,
          {
            ...(typeof title === "string" && { title }),
            ...(typeof icon === "string" && { icon }),
            ...(typeof defaultOpen === "boolean" && { defaultOpen }),
            ...(typeof hideRawDetails === "boolean" && { hideRawDetails }),
          },
        ]]
      }),
    )
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }
}
