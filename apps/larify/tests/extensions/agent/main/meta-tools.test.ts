import { asSchema, tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import agentPlugin from '../../../../src/extensions/agent/main'
import { createSearchMemoryTool } from '../../../../src/extensions/agent/main/search-memory'
import { contextWorkerToken } from '../../../../src/extensions/context/main/service'
import { Registry } from '../../../../src/shared/infra/registry'
import { PluginHost, pluginHostToken } from '../../../../src/main/core/plugin'
import type { Tool } from '../../../../src/main/core/plugin/protocol'

type Memory = { search: ReturnType<typeof vi.fn> }

async function createHost(memory?: Memory): Promise<PluginHost> {
  const registry = new Registry()
  const host = new PluginHost(registry, {
    discover: (pluginId) =>
      pluginId === 'demo'
        ? [
            {
              name: 'eager',
              path: 'eager/SKILL.md',
              description: 'Eager skill',
              metadata: { eager: true }
            },
            { name: 'lazy', path: 'lazy/SKILL.md', description: 'Lazy skill' }
          ]
        : pluginId === 'skill-only'
          ? [{ name: 'only', path: 'only/SKILL.md', description: 'Only skill' }]
          : []
  })
  registry.register(pluginHostToken, host)
  if (memory) registry.register(contextWorkerToken, memory)
  await host.activate({
    manifest: { id: 'demo', description: 'Demo plugin' },
    activate(context) {
      context.registerTool('eager', tool({ metadata: { eager: true }, inputSchema: z.object({}) }))
      context.registerTool(
        'lazy',
        tool({ description: 'Lazy tool', inputSchema: z.object({ value: z.string() }) })
      )
    }
  })
  await host.activate(agentPlugin)
  host.refreshSkills()
  return host
}

async function createTools(memory?: Memory): Promise<Record<string, Tool>> {
  return Object.fromEntries((await createHost(memory)).getTools('agent')!)
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

  it('requests a context reset with a handoff', async () => {
    const requestContextReset = vi.fn()
    const tool = (await createTools()).agent_reset_context
    const schema = await asSchema(tool.inputSchema).jsonSchema

    await expect(
      run(
        tool,
        {
          handoff: 'Continue from task.md.'
        },
        { requestContextReset }
      )
    ).resolves.toBe('Context reset requested.')
    expect(requestContextReset).toHaveBeenCalledWith('Continue from task.md.')
    expect(schema.required).toEqual(expect.arrayContaining(['handoff', 'toolCallTitle']))
    expect(schema.properties).not.toHaveProperty('title')
  })

  it('starts a user-visible progress stage', async () => {
    const tool = (await createTools()).agent_show_progress
    const schema = await asSchema(tool.inputSchema).jsonSchema

    await expect(run(tool, { title: '读取 package.json' })).resolves.toBe('Progress shown.')
    expect(schema.required).toEqual(expect.arrayContaining(['title', 'toolCallTitle']))
    expect(schema.properties?.title).toMatchObject({ type: 'string', minLength: 1 })
  })

  it('searches shared memory without a workspace argument', async () => {
    const search = vi.fn().mockResolvedValue([{ name: 'Audio' }])
    const tool = (await createTools({ search })).agent_search_memory

    await expect(run(tool, { query: 'audio' })).resolves.toEqual([{ name: 'Audio' }])
    await run(tool, { query: 'bluetooth', limit: 5 })

    expect(search).toHaveBeenNthCalledWith(1, 'audio', 20)
    expect(search).toHaveBeenNthCalledWith(2, 'bluetooth', 5)
  })

  it('exposes a query-only memory schema with an optional bounded limit', async () => {
    const schema = await asSchema((await createTools()).agent_search_memory.inputSchema).jsonSchema

    expect(schema.required).toEqual(expect.arrayContaining(['query', 'toolCallTitle']))
    expect(schema.required).not.toContain('limit')
    expect(schema.properties).not.toHaveProperty('cwd')
    expect(schema.properties?.limit).toMatchObject({
      type: 'integer',
      exclusiveMinimum: 0,
      maximum: 100,
      default: 20
    })
  })

  it('reports unavailable memory search', async () => {
    const tool = (await createTools()).agent_search_memory

    await expect(run(tool, { query: 'audio' })).rejects.toThrow('Memory search is unavailable.')
  })

  it('finds memory registered after the Agent tool was created', async () => {
    const registry = new Registry()
    const tool = createSearchMemoryTool(registry)
    const search = vi.fn().mockResolvedValue(['result'])

    registry.register(contextWorkerToken, { search })

    await expect(run(tool, { query: 'audio' })).resolves.toEqual(['result'])
    expect(search).toHaveBeenCalledWith('audio', 20)
  })

  it('discovers plugins and all of their capabilities including eager', async () => {
    const tools = await createTools()

    await expect(run(tools.agent_list_plugins, {})).resolves.toEqual([
      {
        name: 'agent',
        description:
          'List plugins, list tools, list skills, read schemas, search memory, ask user, show progress, reset context, and schedule tasks. (9 tools, 0 skills)'
      },
      { name: 'demo', description: 'Demo plugin (2 tools, 2 skills)' }
    ])
    await expect(run(tools.agent_list_tools, { plugin_names: ['demo'] })).resolves.toEqual([
      { tool_name: 'demo_eager' },
      { tool_name: 'demo_lazy', description: 'Lazy tool' }
    ])
    await expect(run(tools.agent_list_skills, { plugin_names: ['demo'] })).resolves.toEqual([
      { description: 'Eager skill', path: 'eager/SKILL.md' },
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
    expect(definition.inputSchema.required).toEqual(
      expect.arrayContaining(['value', 'toolCallTitle'])
    )
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

  it('lists eager-only plugins but hides plugins without tools or skills', async () => {
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
      }
    })
    await host.activate({
      manifest: { id: 'skill-only' },
      activate(context) {
        void context
      }
    })
    host.refreshSkills()
    const tools = Object.fromEntries(host.getTools('agent')!)

    await expect(run(tools.agent_list_plugins, {})).resolves.toEqual([
      {
        name: 'agent',
        description:
          'List plugins, list tools, list skills, read schemas, search memory, ask user, show progress, reset context, and schedule tasks. (9 tools, 0 skills)'
      },
      { name: 'demo', description: 'Demo plugin (2 tools, 2 skills)' },
      { name: 'eager-only', description: '(1 tools, 0 skills)' },
      { name: 'skill-only', description: '(0 tools, 1 skills)' }
    ])
  })
})
