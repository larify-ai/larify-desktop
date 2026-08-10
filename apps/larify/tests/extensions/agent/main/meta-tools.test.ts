import { asSchema, tool } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import agentPlugin from '../../../../src/extensions/agent/main'
import { Registry } from '../../../../src/shared/infra/registry'
import { PluginHost, pluginHostToken } from '../../../../src/main/core/plugin'
import type { Tool } from '../../../../src/main/core/plugin/protocol'

async function createHost(): Promise<PluginHost> {
  const registry = new Registry()
  const host = new PluginHost(registry)
  registry.register(pluginHostToken, host)
  await host.activate({
    manifest: { id: 'demo', description: 'Demo plugin' },
    activate(context) {
      context.registerTool('eager', tool({ metadata: { eager: true }, inputSchema: z.object({}) }))
      context.registerTool(
        'lazy',
        tool({ description: 'Lazy tool', inputSchema: z.object({ value: z.string() }) })
      )
      context.registerSkill('eager', {
        path: 'eager/SKILL.md',
        description: 'Eager skill',
        metadata: { eager: true }
      })
      context.registerSkill('lazy', {
        path: 'lazy/SKILL.md',
        description: 'Lazy skill'
      })
    }
  })
  await host.activate(agentPlugin)
  return host
}

async function createTools(): Promise<Record<string, Tool>> {
  return Object.fromEntries((await createHost()).getTools('agent')!)
}

async function run(tool: Tool, input: unknown, context = {}): Promise<unknown> {
  if (!tool.execute) throw new Error('Tool is not executable.')
  return tool.execute(input, {
    context,
    abortSignal: undefined
  } as Parameters<typeof tool.execute>[1])
}

describe('meta tools', () => {
  it('registers proactive user communication', async () => {
    const tool = (await createTools()).agent_ask_user

    expect(tool).toBeDefined()
    expect(tool.execute).toBeUndefined()
    const schema = await asSchema(tool.inputSchema).jsonSchema
    expect(schema.properties).toMatchObject({
      message: { type: 'string' },
      options: { type: 'array' },
      multiple: { type: 'boolean' }
    })
    expect(schema.required).toContain('message')
    expect(schema.required).not.toContain('options')
  })

  it('discovers plugins and their non-eager capabilities', async () => {
    const tools = await createTools()

    await expect(run(tools.agent_list_plugins, {})).resolves.toEqual([
      { name: 'demo', description: 'Demo plugin (2 tools, 2 skills)' }
    ])
    await expect(run(tools.agent_list_tools, { plugin_names: ['demo'] })).resolves.toEqual([
      { tool_name: 'demo_lazy', description: 'Lazy tool' }
    ])
    await expect(run(tools.agent_list_skills, { plugin_names: ['demo'] })).resolves.toEqual([
      { description: 'Lazy skill', path: 'lazy/SKILL.md' }
    ])
  })

  it('returns the wrapped tool schema', async () => {
    const tools = await createTools()
    const [definition] = await run(tools.agent_get_tool_schemas, {
      tool_names: ['demo_lazy']
    })

    expect(definition).toMatchObject({
      type: 'function',
      name: 'demo_lazy',
      description: 'Lazy tool'
    })
    expect(definition.inputSchema.required).toEqual(expect.arrayContaining(['value', '_title']))
  })

  it('rejects unknown plugins and tools clearly', async () => {
    const tools = await createTools()

    await expect(run(tools.agent_list_tools, { plugin_names: ['missing'] })).rejects.toThrow(
      'Plugin "missing" not found.'
    )
    await expect(run(tools.agent_list_skills, { plugin_names: ['missing'] })).rejects.toThrow(
      'Plugin "missing" not found.'
    )
    await expect(run(tools.agent_get_tool_schemas, { tool_names: ['missing'] })).rejects.toThrow(
      'Tool "missing" not found.'
    )
  })

  it('hides plugins without discoverable contributions', async () => {
    const host = await createHost()
    await host.activate({
      manifest: { id: 'empty' },
      activate(context) {
        void context
      }
    })
    await host.activate({
      manifest: { id: 'eager-only' },
      activate(context) {
        context.registerTool('tool', tool({ metadata: { eager: true }, inputSchema: z.object({}) }))
        context.registerSkill('skill', {
          path: 'skill/SKILL.md',
          description: 'Eager skill',
          metadata: { eager: true }
        })
      }
    })
    const tools = Object.fromEntries(host.getTools('agent')!)

    await expect(run(tools.agent_list_plugins, {})).resolves.toEqual([
      { name: 'demo', description: 'Demo plugin (2 tools, 2 skills)' }
    ])
  })
})
