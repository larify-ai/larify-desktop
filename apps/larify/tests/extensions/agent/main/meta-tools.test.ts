import { tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMetaTools } from '../../../../src/extensions/agent/main/meta-tools'
import { ExtensionHost } from '../../../../src/main/core/extension'

async function createHost(): Promise<ExtensionHost> {
  const host = new ExtensionHost()
  await host.activate({
    name: 'demo',
    description: 'Demo plugin',
    activate(app) {
      app.registerTool('eager', tool({ metadata: { eager: true }, inputSchema: z.object({}) }))
      app.registerTool(
        'lazy',
        tool({ description: 'Lazy tool', inputSchema: z.object({ value: z.string() }) })
      )
      app.registerSkill('eager', {
        path: 'eager/SKILL.md',
        description: 'Eager skill',
        metadata: { eager: true }
      })
      app.registerSkill('lazy', {
        path: 'lazy/SKILL.md',
        description: 'Lazy skill'
      })
    }
  })
  return host
}

const run = async (tool: any, input: unknown, context = {}) =>
  tool.execute(input, { context, abortSignal: undefined })

describe('meta tools', () => {
  it('discovers plugins and their non-eager capabilities', async () => {
    const tools = createMetaTools(await createHost())

    await expect(run(tools.list_plugins, {})).resolves.toEqual([
      { name: 'demo', description: 'Demo plugin', tools: 2, skills: 2 }
    ])
    await expect(run(tools.list_more_tools, { plugin_names: ['demo'] })).resolves.toEqual([
      { name: 'demo_lazy', description: 'Lazy tool' }
    ])
    await expect(run(tools.list_more_skills, { plugin_names: ['demo'] })).resolves.toEqual([
      { description: 'Lazy skill', path: 'lazy/SKILL.md' }
    ])
  })

  it('returns the wrapped tool schema', async () => {
    const tools = createMetaTools(await createHost())
    const [definition] = await run(tools.get_tool_schemas, { tool_names: ['demo_lazy'] })

    expect(definition).toMatchObject({
      type: 'function',
      name: 'demo_lazy',
      description: 'Lazy tool'
    })
    expect(definition.inputSchema.required).toEqual(expect.arrayContaining(['value', '_title']))
  })

  it('rejects unknown plugins and tools clearly', async () => {
    const tools = createMetaTools(await createHost())

    await expect(run(tools.list_more_tools, { plugin_names: ['missing'] })).rejects.toThrow(
      'Plugin "missing" not found.'
    )
    await expect(run(tools.get_tool_schemas, { tool_names: ['missing'] })).rejects.toThrow(
      'Tool "missing" not found.'
    )
  })

  it('searches the current or selected workspace', async () => {
    const search = vi.fn().mockResolvedValue(['result'])
    const tools = createMetaTools(await createHost(), { search })

    await expect(
      run(tools.search_context, { query: 'audio', limit: 5 }, { cwd: 'current' })
    ).resolves.toEqual(['result'])
    await run(
      tools.search_context,
      { query: 'audio', cwd: 'selected', limit: 2 },
      { cwd: 'current' }
    )

    expect(search).toHaveBeenNthCalledWith(1, 'current', 'audio', 5)
    expect(search).toHaveBeenNthCalledWith(2, 'selected', 'audio', 2)
  })

  it('reports unavailable context search', async () => {
    const tools = createMetaTools(await createHost())

    await expect(
      run(tools.search_context, { query: 'audio', limit: 5 }, { cwd: 'current' })
    ).rejects.toThrow('Context search tool is unavailable.')
  })
})
