import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  prepare: vi.fn(),
  run: vi.fn(),
  title: vi.fn()
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
vi.mock('../../../../src/main/core/session/title', () => ({
  generateSessionTitle: mocks.title
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
  mocks.title.mockResolvedValue('Greeting')
})

describe('runStoredAgentSession', () => {
  it('saves the request and each completed step', async () => {
    const finalAssistant = { ...assistant, metadata: { startedAt: 1, completedAt: 2 } }
    mocks.run.mockImplementation(async (_messages, _options, _onChunk, onMessage) => {
      onMessage(assistant)
      return [history, user, finalAssistant]
    })
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [history, user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    const result = await runStoredAgentSession(sessions as never, {
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
    expect(sessions.saveMessages).toHaveBeenNthCalledWith(1, 'session', [assistant])
    expect(sessions.saveMessages).toHaveBeenNthCalledWith(2, 'session', [finalAssistant])
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(result).toBe(finalAssistant)
  })

  it('passes the reset continuation assistant into the UI merge identity', async () => {
    // reset 续写：模型输入末尾是 compaction user。应读取截断前最后一条 assistant 并作为
    // uiOriginalMessages 末尾传入 runAgentSession，使 AI SDK 复用其 id 合并成一条。
    const compactionUser: UIMessage = {
      id: 'compaction',
      role: 'user',
      metadata: { compaction: true },
      parts: [{ type: 'text', text: '# Handoff\nContinue.' }]
    }
    const earlierAssistant: UIMessage = {
      id: 'earlier',
      role: 'assistant',
      parts: [{ type: 'text', text: 'prior' }]
    }
    mocks.prepare.mockResolvedValue([compactionUser])
    mocks.run.mockResolvedValue([compactionUser])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [compactionUser]),
      loadLastAssistantBeforeStart: vi.fn(() => earlierAssistant),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      options: {} as never
    })

    expect(sessions.loadLastAssistantBeforeStart).toHaveBeenCalledWith('session')
    expect(mocks.run).toHaveBeenCalledTimes(1)
    // 第 5 参 uiOriginalMessages 应为「模型输入 + reset 前 assistant」作为合并底座
    expect(mocks.run.mock.calls[0][4]).toEqual([compactionUser, earlierAssistant])
  })

  it('does not return an assistant message from an earlier run', async () => {
    mocks.run.mockResolvedValue([history, user])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [history, user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await expect(
      runStoredAgentSession(sessions as never, {
        sessionId: 'session',
        cwd: 'cwd',
        message: user,
        options: {} as never
      })
    ).resolves.toBeUndefined()
    expect(sessions.saveMessages).not.toHaveBeenCalled()
  })

  it('does not save an incomplete response when streaming fails', async () => {
    mocks.run.mockRejectedValue(new Error('stream failed'))

    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
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

  it('generates a title for the first non-trivial user message', async () => {
    mocks.run.mockResolvedValue([user])
    const onTitle = vi.fn()
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { ...user, parts: [{ type: 'text', text: 'explain this issue' }] },
      onTitle,
      options: {} as never
    })
    await vi.waitFor(() =>
      expect(sessions.renameSession).toHaveBeenCalledWith('session', 'Greeting')
    )
    expect(mocks.title).toHaveBeenCalledWith('explain this issue')
    expect(onTitle).toHaveBeenCalledWith('Greeting')
  })

  it('finishes only after the generated title is persisted', async () => {
    const title = Promise.withResolvers<string>()
    mocks.title.mockReturnValue(title.promise)
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
    const running = runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { ...user, parts: [{ type: 'text', text: 'explain this issue' }] },
      options: {} as never
    })

    let finished = false
    void running.then(() => {
      finished = true
    })
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    expect(finished).toBe(false)

    title.resolve('Generated title')
    await running
    expect(sessions.renameSession).toHaveBeenCalledWith('session', 'Generated title')
  })

  it('skips title generation for short messages', async () => {
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      options: {} as never
    })

    expect(mocks.title).not.toHaveBeenCalled()
    expect(sessions.renameSession).not.toHaveBeenCalled()
  })

  it('skips title generation for an existing session or an explicit title', async () => {
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
    const message = { ...user, parts: [{ type: 'text' as const, text: 'explain this issue' }] }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'existing',
      cwd: 'cwd',
      message,
      options: {} as never
    })
    sessions.hasSession.mockReturnValue(false)
    await runStoredAgentSession(sessions as never, {
      sessionId: 'named',
      cwd: 'cwd',
      message,
      title: 'Named task',
      options: {} as never
    })

    expect(mocks.title).not.toHaveBeenCalled()
    expect(sessions.renameSession).not.toHaveBeenCalled()
  })

  it('keeps the derived title when title generation fails or returns empty text', async () => {
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
    const message = { ...user, parts: [{ type: 'text' as const, text: 'explain this issue' }] }

    mocks.title.mockRejectedValueOnce(new Error('title failed')).mockResolvedValueOnce('')
    await runStoredAgentSession(sessions as never, {
      sessionId: 'failed',
      cwd: 'cwd',
      message,
      options: {} as never
    })
    await runStoredAgentSession(sessions as never, {
      sessionId: 'empty',
      cwd: 'cwd',
      message,
      options: {} as never
    })
    await vi.waitFor(() => expect(mocks.title).toHaveBeenCalledTimes(2))

    expect(sessions.renameSession).not.toHaveBeenCalled()
  })
})
