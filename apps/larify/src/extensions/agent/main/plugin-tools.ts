import { asSchema } from 'ai'
import { z } from 'zod'
import type { PluginHost } from '../../../main/core/plugin/host'
import { defineTool, type Skill, type Tool } from '../../../main/core/plugin/protocol'

const pluginNamesSchema = z
  .object({ plugin_names: z.array(z.string()).min(1).describe('Plugin names') })
  .strict()

function hasDiscoverableContributions(
  tools: ReadonlyMap<string, Tool>,
  skills: ReadonlyMap<string, Skill>
): boolean {
  return [...tools.values(), ...skills.values()].some(({ metadata }) => metadata?.eager !== true)
}

function describePlugin(description: string | undefined, tools: number, skills: number): string {
  return `${description ? `${description} ` : ''}(${tools} tools, ${skills} skills)`
}

function collectTools(host: PluginHost): Map<string, Tool> {
  return new Map(host.listPlugins().flatMap(({ id }) => [...(host.getTools(id) ?? [])]))
}

function createListPluginsTool(host: PluginHost): Tool {
  return defineTool({
    description: 'List more plugins.',
    inputSchema: z.object({}).strict(),
    metadata: { eager: true, icon: 'search' },
    execute: async () => {
      const result: Array<{ name: string; description: string }> = []
      for (const { id, description } of host.listPlugins()) {
        const tools = host.getTools(id) ?? new Map()
        const skills = host.getSkills(id) ?? new Map()
        if (!hasDiscoverableContributions(tools, skills)) continue
        result.push({
          name: id,
          description: describePlugin(description, tools.size, skills.size)
        })
      }
      return result
    }
  })
}

function createListToolsTool(host: PluginHost): Tool {
  return defineTool({
    description: 'List more tools.',
    inputSchema: pluginNamesSchema,
    metadata: { eager: true, icon: 'search' },
    execute: async ({ plugin_names }) =>
      plugin_names.flatMap((plugin) => {
        const tools = host.getTools(plugin)
        if (!tools) throw new Error(`Plugin "${plugin}" not found.`)
        return [...tools]
          .filter(([, tool]) => tool.metadata?.eager !== true)
          .map(([tool_name, tool]) => ({
            tool_name,
            ...(typeof tool.description === 'string' && { description: tool.description })
          }))
      })
  })
}

function createListSkillsTool(host: PluginHost): Tool {
  return defineTool({
    description: 'List more skills.',
    inputSchema: pluginNamesSchema,
    metadata: { eager: true, icon: 'search' },
    execute: async ({ plugin_names }) =>
      plugin_names.flatMap((plugin) => {
        const skills = host.getSkills(plugin)
        if (!skills) throw new Error(`Plugin "${plugin}" not found.`)
        return [...skills.values()]
          .filter((skill) => skill.metadata?.eager !== true)
          .map(({ path, description }) => ({ path, description }))
      })
  })
}

function createGetToolSchemasTool(host: PluginHost): Tool {
  return defineTool({
    description: 'Read tool schemas.',
    inputSchema: z
      .object({ tool_names: z.array(z.string()).min(1).describe('Tool names') })
      .strict(),
    metadata: { eager: true, icon: 'search' },
    execute: async ({ tool_names }) => {
      const tools = collectTools(host)
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
  })
}

export function createPluginTools(host: PluginHost): Record<string, Tool> {
  return {
    list_plugins: createListPluginsTool(host),
    list_tools: createListToolsTool(host),
    list_skills: createListSkillsTool(host),
    get_tool_schemas: createGetToolSchemasTool(host)
  }
}
