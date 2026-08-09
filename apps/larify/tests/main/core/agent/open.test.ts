import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agent: { dispose: vi.fn() },
  handlers: { dispose: vi.fn() },
  createAgent: vi.fn(),
  registerHandlers: vi.fn()
}))

vi.mock('../../../../src/main/core/agent/agent', () => ({
  Agent: class {
    constructor(sessions: unknown, pluginHost: unknown) {
      mocks.createAgent(sessions, pluginHost)
      return mocks.agent
    }
  }
}))

vi.mock('../../../../src/main/core/agent/ipc', () => ({
  registerAgentHandlers: mocks.registerHandlers
}))

import { agentToken, registerAgent } from '../../../../src/main/core/agent/open'
import { sessionToken } from '../../../../src/main/core/session'
import { pluginHostToken } from '../../../../src/main/core/plugin'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.registerHandlers.mockReturnValue(mocks.handlers)
})

describe('registerAgent', () => {
  it('registers the agent and its IPC handlers', () => {
    const sessions = { dispose: vi.fn() }
    const pluginHost = {}
    const get = vi.fn((token) => (token === sessionToken ? sessions : pluginHost))
    const register = vi.fn()

    registerAgent({ registry: { get, register } } as never)

    expect(get).toHaveBeenCalledWith(sessionToken)
    expect(get).toHaveBeenCalledWith(pluginHostToken)
    expect(mocks.createAgent).toHaveBeenCalledWith(sessions, pluginHost)
    expect(mocks.registerHandlers).toHaveBeenCalledWith(mocks.agent)
    expect(register.mock.calls[0]).toEqual([agentToken, mocks.agent])
    expect(register.mock.calls[1][1]).toBe(mocks.handlers)
  })

  it('requires the session service', () => {
    expect(() => registerAgent({ registry: { get: vi.fn(), register: vi.fn() } } as never)).toThrow(
      'Session service is unavailable.'
    )
  })

  it('requires the PluginHost service', () => {
    const sessions = {}
    const get = vi.fn((token) => (token === sessionToken ? sessions : undefined))

    expect(() => registerAgent({ registry: { get, register: vi.fn() } } as never)).toThrow(
      'PluginHost is unavailable.'
    )
  })
})
