import { asSchema, tool } from "ai"
import { z } from "zod"
import type { Toolkit } from "../../../shared/tool"
import type { ToolRegistry } from "./registry"

export function createAgentToolkit(registry: ToolRegistry): Toolkit {
  return {
    name: "agent",
    description: "Discover and load tools that are not directly available.",
    tools: {
      list_toolkit_tools: tool({
        description: "First list tools with agent_list_toolkit_tools, then read schemas with agent_get_tool_schemas.",
        inputSchema: z
          .object({ toolkit_names: z.array(z.string()).min(1).describe("The toolkit names") })
          .strict(),
        metadata: { eager: true, icon: "search" },
        execute: async (args) => {
          const { toolkit_names } = args
          const toolkits = toolkit_names.map((toolkit) => {
            const listed = registry.listTools(toolkit)
            if (!listed) throw new Error(`Toolkit "${toolkit}" not found.`)
            return { toolkit_name: toolkit, ...listed }
          })
          return JSON.stringify({ toolkits })
        },
      }),
      get_tool_schemas: tool({
        description: "First list tools with agent_list_toolkit_tools, then read schemas with agent_get_tool_schemas.",
        inputSchema: z
          .object({
            tool_names: z.array(z.string()).min(1).describe("Tool names in {toolkit_name}_{tool_name} format"),
          })
          .strict(),
        metadata: { eager: true, icon: "search" },
        execute: async (args) => {
          const { tool_names } = args
          const definitions = await Promise.all(
            tool_names.map(async (name) => {
              const found = registry.tool(name)
              if (!found) throw new Error(`Tool "${name}" not found.`)
              return {
                type: "function",
                name,
                ...(found.description ? { description: found.description } : {}),
                inputSchema: await asSchema(found.inputSchema).jsonSchema,
              }
            }),
          )
          return JSON.stringify(definitions)
        },
      }),
    },
  }
}
