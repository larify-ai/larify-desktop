import { asSchema, tool, type Tool } from 'ai'
import { z } from 'zod'
import type { ExtensionHost } from '../../../main/core/extension'
import { defineTool } from '../../../shared/extension/tool'

export interface ContextSearch {
  search(cwd: string, query: string, limit?: number): Promise<unknown>
}

export function createMetaTools(
  host: ExtensionHost,
  context?: ContextSearch
): Record<string, Tool> {
  return {
    list_plugins: tool({
      description: 'List plugins.',
      inputSchema: z.object({}).strict(),
      metadata: { eager: true, icon: 'search' },
      execute: async () => host.listPlugins()
    }),
    list_more_tools: tool({
      description: 'List more tools from plugins.',
      inputSchema: z
        .object({ plugin_names: z.array(z.string()).min(1).describe('Plugin names') })
        .strict(),
      metadata: { eager: true, icon: 'search' },
      execute: async ({ plugin_names }) =>
        plugin_names.flatMap((plugin) => {
          const tools = host.listTools(plugin, false)
          if (!tools) throw new Error(`Plugin "${plugin}" not found.`)
          return tools
        })
    }),
    list_more_skills: tool({
      description: 'List more skills from plugins.',
      inputSchema: z
        .object({ plugin_names: z.array(z.string()).min(1).describe('Plugin names') })
        .strict(),
      metadata: { eager: true, icon: 'search' },
      execute: async ({ plugin_names }) =>
        plugin_names.flatMap((plugin) => {
          const skills = host.listSkills(plugin, false)
          if (!skills) throw new Error(`Plugin "${plugin}" not found.`)
          return skills
        })
    }),
    get_tool_schemas: tool({
      description: 'Read tool schemas.',
      inputSchema: z
        .object({ tool_names: z.array(z.string()).min(1).describe('Tool names') })
        .strict(),
      metadata: { eager: true, icon: 'search' },
      execute: async ({ tool_names }) => {
        const tools = host.getTools()
        return Promise.all(
          tool_names.map(async (name) => {
            const found = tools.get(name)
            if (!found) throw new Error(`Tool "${name}" not found.`)
            return {
              type: 'function',
              name,
              ...(found.description ? { description: found.description } : {}),
              inputSchema: await asSchema(found.inputSchema).jsonSchema
            }
          })
        )
      }
    }),
    search_context: defineTool({
      description: 'Search relevant context using hybrid retrieval (bm25 and vector).',
      inputSchema: z.object({
        query: z.string().min(1).describe('Search query'),
        cwd: z
          .string()
          .optional()
          .describe(
            'Workspace directory; defaults to cwd. Find others in `~/.larify/indexes/registry.json`'
          ),
        limit: z.number().int().positive().max(200).default(100).describe('Maximum results')
      }),
      metadata: { eager: true, icon: 'search' },
      execute: ({ query, cwd: target, limit }, { cwd }) => {
        if (!context) throw new Error('Context search tool is unavailable.')
        return context.search(target ?? cwd, query, limit)
      }
    })
  }
}
