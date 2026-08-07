import { describe, expect, it, vi } from 'vitest'
import type { AgentOptions } from '../../../../src/main/core/agent/engine'
import { createAgentRuntime } from '../../../../src/main/core/agent/runtime'

describe('createAgentRuntime', () => {
  it('assembles tools and their session context', () => {
    const tools = { read: {} as never, edit: {} as never }
    const runtime = createAgentRuntime({ sessionId: 'session', cwd: 'cwd', tools })

    expect(runtime.tools).toBe(tools)
    expect(runtime.activeTools).toEqual(['read', 'edit'])
    expect(runtime.toolsContext).toEqual({
      read: { sessionId: 'session', cwd: 'cwd' },
      edit: { sessionId: 'session', cwd: 'cwd' }
    })
    expect(runtime.system).toContain('cwd')
  })

  it('uses the default stop condition', () => {
    const runtime = createAgentRuntime({ sessionId: 'session', cwd: 'cwd' })

    expect(runtime.stopWhen).toBeTypeOf('function')
  })

  it('uses a custom stop condition', () => {
    const stopWhen = vi.fn(() => false) as AgentOptions['stopWhen']
    const runtime = createAgentRuntime({ sessionId: 'session', cwd: 'cwd', stopWhen })

    expect(runtime.stopWhen).toBe(stopWhen)
  })
})
