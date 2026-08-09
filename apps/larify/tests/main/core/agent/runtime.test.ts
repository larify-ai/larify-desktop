import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AgentOptions } from '../../../../src/main/core/agent/engine'
import { createAgentRuntime } from '../../../../src/main/core/agent/runtime'
import { PluginHost, defineTool } from '../../../../src/main/core/plugin'
import { Registry } from '../../../../src/main/infra/registry'

describe('createAgentRuntime', () => {
  it('assembles plugin tools and their session context', async () => {
    const host = new PluginHost(new Registry())
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
        context.registerSkill('review', {
          path: 'review/SKILL.md',
          description: 'Review',
          metadata: { eager: true }
        })
        context.registerSkill('optional', {
          path: 'optional/SKILL.md',
          description: 'Optional'
        })
      }
    })
    await host.activate({
      manifest: { id: 'lazy' },
      activate(context) {
        context.registerSkill('optional', {
          path: 'lazy/SKILL.md',
          description: 'Lazy only'
        })
      }
    })
    const runtime = createAgentRuntime({ sessionId: 'session', cwd: 'cwd' }, host)

    expect(Object.keys(runtime.tools)).toEqual(['files_edit', 'files_read'])
    expect(runtime.activeTools).toEqual(['files_read'])
    expect(runtime.toolsContext).toEqual({
      files_edit: { sessionId: 'session', cwd: 'cwd' },
      files_read: { sessionId: 'session', cwd: 'cwd' }
    })
    expect(runtime.system).toContain('cwd')
    expect(runtime.system).toContain('`files`:')
    expect(runtime.system).toContain('review/SKILL.md')
    expect(runtime.system).toContain('files_review')
    expect(runtime.system).not.toContain('optional/SKILL.md')
    expect(runtime.system).not.toContain('`lazy`:')
  })

  it('uses the default stop condition', () => {
    const runtime = createAgentRuntime(
      { sessionId: 'session', cwd: 'cwd' },
      new PluginHost(new Registry())
    )

    expect(runtime.stopWhen).toBeTypeOf('function')
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
