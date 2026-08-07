import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agent: { dispose: vi.fn() },
  handlers: { dispose: vi.fn() },
  createAgent: vi.fn(),
  registerHandlers: vi.fn()
}))

vi.mock('../../../../src/main/core/agent/agent', () => ({
  Agent: class {
    constructor(sessions: unknown) {
      mocks.createAgent(sessions)
      return mocks.agent
    }
  }
}))

vi.mock('../../../../src/main/core/agent/ipc', () => ({
  registerAgentHandlers: mocks.registerHandlers
}))

import { agentToken, registerAgent } from '../../../../src/main/core/agent/open'
import { sessionToken } from '../../../../src/main/core/session'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.registerHandlers.mockReturnValue(mocks.handlers)
})

describe('registerAgent', () => {
  it('registers the agent and its IPC handlers', () => {
    const sessions = { dispose: vi.fn() }
    const get = vi.fn(() => sessions)
    const register = vi.fn()

    registerAgent({ registry: { get, register } } as never)

    expect(get).toHaveBeenCalledWith(sessionToken)
    expect(mocks.createAgent).toHaveBeenCalledWith(sessions)
    expect(mocks.registerHandlers).toHaveBeenCalledWith(mocks.agent)
    expect(register.mock.calls[0]).toEqual([agentToken, mocks.agent])
    expect(register.mock.calls[1][1]).toBe(mocks.handlers)
  })

  it('requires the session service', () => {
    expect(() => registerAgent({ registry: { get: vi.fn(), register: vi.fn() } } as never)).toThrow(
      'Session service is unavailable.'
    )
  })
})
