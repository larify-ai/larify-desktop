import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentOptions } from '../../../../src/main/core/agent/engine'
import { contextRolloverPrompt } from '../../../../src/main/core/agent/context-rollover'
import { createAgentRuntime } from '../../../../src/main/core/agent/runtime'
import { FilesystemSkillDiscovery, PluginHost, defineTool } from '../../../../src/main/core/plugin'
import { Registry } from '../../../../src/shared/infra/registry'

// createModelRuntime requires cached gateway credentials since the switch to
// per-user sk- keys; provide a fake so runtime construction can proceed.
vi.mock('../../../../src/main/model-api/service', () => ({
  getModelApiService: () => ({
    getCachedCredentialsSync: () => ({ baseUrl: 'https://api.larify.ai', apiKey: 'sk-test' })
  })
}))

describe('createAgentRuntime', () => {
  it('loads the bundled agent skill into the runtime prompt', async () => {
    const host = new PluginHost(new Registry(), new FilesystemSkillDiscovery())
    await host.activate({ manifest: { id: 'agent' }, activate: () => undefined })

    const runtime = createAgentRuntime({ sessionId: 'session', cwd: 'cwd' }, host)

    expect(runtime.system).toContain('agent_task-representation')
    expect(runtime.system).toContain(join('task-representation', 'SKILL.md'))
  })

  it('assembles plugin tools and their session context', async () => {
    const host = new PluginHost(new Registry(), {
      discover: (pluginId) => {
        if (pluginId === 'files') {
          return [
            {
              name: 'review',
              path: 'review/SKILL.md',
              description: 'Review',
              metadata: { eager: true }
            },
            { name: 'optional', path: 'optional/SKILL.md', description: 'Optional' }
          ]
        }
        if (pluginId === 'lazy') {
          return [{ name: 'optional', path: 'lazy/SKILL.md', description: 'Lazy only' }]
        }
        return []
      }
    })
    await host.activate({
      manifest: { id: 'files' },
      activate(context) {
        context.registerTool(
          'read',
          defineTool({
            description: 'Read',
            metadata: { eager: true },
            inputSchema: z.object({}),
            execute: () => undefined
          })
        )
        context.registerTool(
          'edit',
          defineTool({
            description: 'Edit',
            inputSchema: z.object({}),
            execute: () => undefined
          })
        )
      }
    })
    await host.activate({
      manifest: { id: 'lazy' },
      activate: () => undefined
    })
    const runtime = createAgentRuntime({ sessionId: 'session', cwd: 'cwd' }, host)

    expect(Object.keys(runtime.tools)).toEqual(['files_edit', 'files_read'])
    expect(runtime.activeTools).toEqual(['files_read'])
    expect(runtime.imageCapable).toBe(true)
    expect(runtime.toolsContext).toEqual({
      files_edit: {
        sessionId: 'session',
        cwd: 'cwd',
        modelId: 'deepseek-v4-flash-vision-exp'
      },
      files_read: {
        sessionId: 'session',
        cwd: 'cwd',
        modelId: 'deepseek-v4-flash-vision-exp'
      }
    })
    expect(runtime.system).toContain('cwd')
    expect(runtime.system).toContain('`files`:')
    expect(runtime.system).toContain('review/SKILL.md')
    expect(runtime.system).toContain('files_review')
    expect(runtime.system).not.toContain('optional/SKILL.md')
    expect(runtime.system).not.toContain('`lazy`:')
  })

  it('marks non-vision models as not image capable', () => {
    const runtime = createAgentRuntime(
      {
        sessionId: 'session',
        cwd: 'cwd',
        modelConfig: { modelId: 'deepseek-v4-flash', reasoningEffort: 'off' }
      },
      new PluginHost(new Registry())
    )

    expect(runtime.imageCapable).toBe(false)
  })

  it('uses the default stop condition and context rollover', async () => {
    const runtime = createAgentRuntime(
      { sessionId: 'session', cwd: 'cwd' },
      new PluginHost(new Registry())
    )

    expect(runtime.stopWhen).toBeTypeOf('function')
    expect(runtime.prepareStep).toBeTypeOf('function')
    const prepared = await runtime.prepareStep?.({
      messages: [{ role: 'user', content: 'Work on the task.' }],
      steps: [
        {
          usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0, totalTokens: 0 }
        }
      ]
    } as never)
    expect(prepared?.messages?.at(-1)).toEqual({
      role: 'user',
      content: contextRolloverPrompt
    })
  })

  it('refreshes file-discovered skills for every runtime', async () => {
    let description = 'First version'
    const host = new PluginHost(new Registry(), {
      discover: () => [
        {
          name: 'dynamic',
          path: 'dynamic/SKILL.md',
          description,
          metadata: { eager: true }
        }
      ]
    })
    await host.activate({ manifest: { id: 'agent' }, activate: () => undefined })

    const first = createAgentRuntime({ sessionId: 'first', cwd: 'cwd' }, host)
    description = 'Second version'
    const second = createAgentRuntime({ sessionId: 'second', cwd: 'cwd' }, host)

    expect(first.system).toContain('First version')
    expect(second.system).toContain('Second version')
    expect(second.system).not.toContain('First version')
  })

  it('uses a custom stop condition', () => {
    const stopWhen = vi.fn(() => false) as AgentOptions['stopWhen']
    const runtime = createAgentRuntime(
      { sessionId: 'session', cwd: 'cwd', stopWhen },
      new PluginHost(new Registry())
    )

    expect(runtime.stopWhen).toBe(stopWhen)
  })
})
