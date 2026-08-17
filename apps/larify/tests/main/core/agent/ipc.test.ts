import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => {
      mocks.removeHandler(channel)
      mocks.handlers.delete(channel)
    }
  }
}))

import { registerAgentHandlers } from '../../../../src/main/core/agent/ipc'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.removeHandler.mockClear()
})

describe('agent IPC', () => {
  it('assembles a request and forwards stream events', () => {
    const send = vi.fn()
    const isDestroyed = vi.fn(() => false)
    const agent = { send: vi.fn(), cancel: vi.fn() }
    registerAgentHandlers(agent as never)

    const request = {
      sessionId: 'session',
      cwd: 'cwd',
      message: { id: 'message', role: 'user', parts: [] },
      modelConfig: { modelId: 'deepseek-v4-pro', reasoningEffort: 'max' }
    }
    mocks.handlers.get('agent:send')!({ sender: { send, isDestroyed } } as never, request as never)

    expect(agent.send).toHaveBeenCalledOnce()
    const [input, sink] = agent.send.mock.calls[0]
    expect(input).toBe(request)

    sink.chunk({ type: 'start' })
    sink.error(new Error('failed'))
    sink.end()
    expect(send).toHaveBeenNthCalledWith(1, 'agent:chunk:session', { type: 'start' })
    expect(send).toHaveBeenNthCalledWith(2, 'agent:error:session', 'failed')
    expect(send).toHaveBeenNthCalledWith(3, 'agent:end:session')
  })

  it('ignores stream events after the renderer is destroyed', () => {
    const send = vi.fn()
    const agent = { send: vi.fn(), cancel: vi.fn() }
    registerAgentHandlers(agent as never)

    mocks.handlers.get('agent:send')!(
      { sender: { send, isDestroyed: () => true } } as never,
      { sessionId: 'session' } as never
    )

    const sink = agent.send.mock.calls[0][1]
    sink.chunk({ type: 'start' })
    sink.error(new Error('failed'))
    sink.end()
    expect(send).not.toHaveBeenCalled()
  })

  it('forwards cancellation by session', () => {
    const agent = { send: vi.fn(), cancel: vi.fn() }
    registerAgentHandlers(agent as never)

    mocks.handlers.get('agent:cancel')!({} as never, 'session' as never)

    expect(agent.cancel).toHaveBeenCalledWith('session')
  })

  it('removes every handler', () => {
    const disposable = registerAgentHandlers({ send: vi.fn(), cancel: vi.fn() } as never)

    disposable.dispose()

    expect(mocks.removeHandler.mock.calls).toEqual([['agent:send'], ['agent:cancel']])
    expect(mocks.handlers.size).toBe(0)
  })
})
