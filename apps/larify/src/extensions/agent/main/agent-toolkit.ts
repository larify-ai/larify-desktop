import { asSchema, tool } from "ai"
import { z } from "zod"
import type { Toolkit } from "../../../shared/tool"
import type { ToolRegistry } from "./registry"
import type { SkillFactory } from "./skill-factory"

export function createAgentToolkit(registry: ToolRegistry, skills?: SkillFactory): Toolkit {
  return {
    name: "agent",
    description: "List tools, read schemas, etc.",
    tools: {
      list_toolkit_tools: tool({
        description: "First list tools with agent_list_toolkit_tools, then read schemas with agent_get_tool_schemas.",
        inputSchema: z
          .object({ toolkit_names: z.array(z.string()).min(1).describe("The toolkit names") })
          .strict(),
        metadata: { eager: true, icon: "search" },
        execute: async (args) => {
          const { toolkit_names } = args
          return toolkit_names
            .map((toolkit) => {
              const listed = registry.listTools(toolkit)
              if (!listed) throw new Error(`Toolkit "${toolkit}" not found.`)
              const lines = listed.tools.map(
                (t) => `- **${t.tool_name}**${t.description ? `: ${t.description}` : ""}`,
              )
              return [`## ${toolkit}`, listed.instruction, lines.join("\n")]
                .filter(Boolean)
                .join("\n\n")
            })
            .join("\n\n")
        },
      }),
      get_tool_schemas: tool({
        description: "First list tools with agent_list_toolkit_tools, then read schemas with agent_get_tool_schemas.",
        inputSchema: z
          .object({
            tool_names: z.array(z.string()).min(1).describe("The tool names"),
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
      list_skills: tool({
        description: "First list skills with agent_list_skills, then read content with fs_read.",
        inputSchema: z.object({}).strict(),
        metadata: { eager: true, icon: "search" },
        execute: async () =>
          skills?.list().map(({ name, description, eager, path }) => ({
            name,
            description,
            eager,
            path,
          })) ?? [],
      }),
    },
  }
}
