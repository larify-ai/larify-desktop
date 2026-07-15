import { asSchema } from "ai"
import { z } from "zod"
import type { Tool, Toolkit } from "../../../shared/tool"

const callToolArgsSchema = (tool: Tool) =>
  z.object({
    name: z.literal(tool.name).describe("The tool name to invoke through call_tool"),
    args: tool.inputSchema,
  })

export const callToolInvocationSchema = (tool: Tool) =>
  z.object({
    title: z.string().min(1).describe("Short user-facing phrase describing the step"),
    args: callToolArgsSchema(tool),
  })

export const createMetaToolkit = (registry: ToolRegistry): Toolkit => ({
  name: "agent",
  description: "List tools and read tool schemas.",
  tools: [
    {
      name: "list_tools",
      description: "List tools in a toolkit.",
      metadata: { icon: "search", lazy: false },
      inputSchema: z.object({
        group: z.string().describe("The toolkit name"),
      }),
      execute: async (args) => {
        const { group } = args as { group: string }
        const tools = registry.listTools(group)
        if (!tools) throw new Error(`Toolkit "${group}" not found`)
        return tools.map((t) => `- **${t.name}** - ${t.description}`).join("\n")
      },
    },
    {
      name: "read_tools",
      description: "Read tool schemas before invoking them.",
      metadata: { icon: "search", lazy: false },
      inputSchema: z.object({
        names: z.array(z.string()).min(1).describe("The tool names"),
      }),
      execute: async (args) => {
        const { names } = args as { names: string[] }
        const entries = names.map((name) => {
          const schema = registry.toolCallSchema(name)
          if (!schema) throw new Error(`Tool "${name}" not found`)
          return [name, schema] as const
        })
        return JSON.stringify(Object.fromEntries(entries))
      },
    },
  ],
})

export const createToolRegistry = (kits: Toolkit[]): ToolRegistry => {
  return new ToolRegistry(kits)
}

export class ToolRegistry {
  private readonly kits = new Map<string, Toolkit>()
  private readonly tools = new Map<string, Tool>()

  constructor(kits: Toolkit[]) {
    this.addKit(createMetaToolkit(this))
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

  toolCallSchema(name: string) {
    const tool = this.get(name)
    if (!tool) return undefined
    return asSchema(callToolInvocationSchema(tool)).jsonSchema
  }

  listEagerTools() {
    return [...this.tools.values()].filter((tool) => tool.metadata?.lazy === false)
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
