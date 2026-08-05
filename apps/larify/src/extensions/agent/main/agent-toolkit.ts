import { asSchema, tool } from "ai"
import { z } from "zod"
import { defineTool } from "../../../shared/extension/tool"
import type { Toolkit } from "../../../shared/toolkit"
import type { ToolRegistry } from "./registry"
import type { SkillFactory } from "./skill-factory"

export interface ContextSearch {
  search(cwd: string, query: string, limit?: number): Promise<unknown>
}

export function createAgentToolkit(
  registry: ToolRegistry,
  skills?: SkillFactory,
  context?: ContextSearch,
): Toolkit {
  return {
    name: "agent",
    description: "List tools, read schemas, list skills, and search context.",
    tools: {
      list_more_toolkits: tool({
        description: "List more toolkits.",
        inputSchema: z.object({}).strict(),
        metadata: { eager: true, icon: "search" },
        execute: async () => registry.listToolkits(false),
      }),
      list_toolkit_tools: tool({
        description:
          "First list tools with agent_list_toolkit_tools, then read schemas with agent_get_tool_schemas.",
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
        description:
          "First list tools with agent_list_toolkit_tools, then read schemas with agent_get_tool_schemas.",
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
      list_more_skills: tool({
        description: "List more skills.",
        inputSchema: z.object({}).strict(),
        metadata: { eager: true, icon: "search" },
        execute: async () =>
          skills
            ?.list()
            .filter(({ eager }) => !eager)
            .map(({ name, description, eager, path }) => ({
              name,
              description,
              eager,
              path,
            })) ?? [],
      }),
      search_context: defineTool({
        description: "Search relevant context using hybrid retrieval (bm25 and vector).",
        inputSchema: z.object({
          query: z.string().min(1).describe("Search query"),
          cwd: z
            .string()
            .optional()
            .describe(
              "Workspace directory; defaults to cwd. Find others in `~/.larify/indexes/registry.json`",
            ),
          limit: z.number().int().positive().max(200).default(100).describe("Maximum results"),
        }),
        metadata: { eager: true, icon: "search" },
        execute: ({ query, cwd: target, limit }, { cwd }) => {
          if (!context) throw new Error("Context search tool is unavailable.")
          return context.search(target ?? cwd, query, limit)
        },
      }),
    },
  }
}
