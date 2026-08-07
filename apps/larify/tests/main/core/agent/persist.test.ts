import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  prepare: vi.fn(),
  run: vi.fn()
}))

vi.mock('../../../../src/main/core/session/save', () => ({
  saveSessionMessages: mocks.save
}))
vi.mock('../../../../src/main/core/agent/messages', () => ({
  prepareMessages: mocks.prepare
}))
vi.mock('../../../../src/main/core/agent/session', () => ({
  runAgentSession: mocks.run
}))
vi.mock('../../../../src/main/core/model', () => ({
  createModel: vi.fn(() => 'model')
}))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'

const user: UIMessage = {
  id: 'user',
  role: 'user',
  parts: [{ type: 'text', text: 'hello' }]
}
const assistant: UIMessage = {
  id: 'assistant',
  role: 'assistant',
  parts: [{ type: 'text', text: '你好' }]
}
const history: UIMessage = {
  id: 'history',
  role: 'assistant',
  parts: [{ type: 'text', text: 'earlier' }]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepare.mockResolvedValue([history, user])
})

describe('runStoredAgentSession', () => {
  it('saves the request and each completed step', async () => {
    mocks.run.mockImplementation(async (_messages, _options, _onChunk, onMessage) => {
      onMessage(assistant)
      return [history, user, assistant]
    })
    const sessions = {
      loadMessages: vi.fn(() => [history, user]),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      options: {} as never
    })

    expect(mocks.save).toHaveBeenNthCalledWith(1, sessions, 'session', 'cwd', [user], undefined)
    expect(sessions.loadMessages).toHaveBeenCalledWith('session')
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.loadMessages.mock.invocationCallOrder[0]
    )
    expect(mocks.prepare).toHaveBeenCalledWith([history, user])
    expect(sessions.saveMessages).toHaveBeenCalledWith('session', [assistant])
    expect(mocks.save).toHaveBeenCalledOnce()
  })

  it('does not save an incomplete response when streaming fails', async () => {
    mocks.run.mockRejectedValue(new Error('stream failed'))

    const sessions = { loadMessages: vi.fn(() => [user]), saveMessages: vi.fn() }
    await expect(
      runStoredAgentSession(sessions as never, {
        sessionId: 'session',
        cwd: 'cwd',
        message: user,
        options: {} as never
      })
    ).rejects.toThrow('stream failed')

    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.save).toHaveBeenCalledWith(sessions, 'session', 'cwd', [user], undefined)
    expect(sessions.saveMessages).not.toHaveBeenCalled()
  })
})
