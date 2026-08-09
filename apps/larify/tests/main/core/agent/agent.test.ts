import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toModel: vi.fn(),
  run: vi.fn(),
  runtime: vi.fn(),
  workspace: 'default-workspace'
}))

vi.mock('../../../../src/main/core/agent/persist', () => ({
  runStoredAgentSession: mocks.run
}))
vi.mock('../../../../src/main/core/agent/runtime', () => ({
  createAgentRuntime: mocks.runtime
}))
vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyWorkspacePath: () => mocks.workspace
}))

import { Agent } from '../../../../src/main/core/agent/agent'

const message: UIMessage = {
  id: 'message',
  role: 'user',
  parts: [{ type: 'text', text: 'hello' }]
}

const input = { sessionId: 'session', message, cwd: 'cwd' }

const sessions = {
  loadMessages: vi.fn(() => [])
}
const pluginHost = {}

beforeEach(() => {
  vi.clearAllMocks()
  sessions.loadMessages.mockReturnValue([])
  mocks.toModel.mockResolvedValue([])
  mocks.run.mockResolvedValue(undefined)
  mocks.runtime.mockReturnValue({ system: 'runtime' })
})

describe('Agent', () => {
  it('assembles and starts a stored run', async () => {
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(input, sink)

    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledOnce())
  })

  it('cancels the active run', async () => {
    let signal: AbortSignal | undefined
    mocks.run.mockImplementation(async (_sessions, input) => {
      signal = input.options.abortSignal
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
    })
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })
    await vi.waitFor(() => expect(signal).toBeDefined())
    agent.cancel('session')

    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
  })

  it('rejects another message while the session is running', async () => {
    let continueStep!: () => void
    const step = new Promise<void>((resolve) => {
      continueStep = resolve
    })
    mocks.run.mockImplementation(async () => {
      await step
    })
    const first = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(input, first)
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    expect(() => agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })).toThrow(
      'Agent is already running.'
    )
    expect(mocks.run).toHaveBeenCalledOnce()
    continueStep()
    await vi.waitFor(() => expect(first.end).toHaveBeenCalledOnce())
  })

  it('starts a fresh worker after cancellation', async () => {
    mocks.run
      .mockImplementationOnce(async (_sessions, input) => {
        await new Promise<void>((resolve) =>
          input.options.abortSignal.addEventListener('abort', () => resolve())
        )
      })
      .mockResolvedValueOnce(undefined)
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    agent.cancel('session')
    agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })

    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2))
  })

  it('assembles the runtime from the request', async () => {
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })

    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    expect(mocks.runtime).toHaveBeenCalledWith(input, pluginHost)
    expect(mocks.run.mock.calls[0][1].options.system).toBe('runtime')
  })

  it('uses the default workspace when cwd is absent', async () => {
    const agent = new Agent(sessions as never, pluginHost as never)
    const request = { sessionId: 'session', message }

    agent.send(request, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })

    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    expect(mocks.runtime).toHaveBeenCalledWith({ ...request, cwd: mocks.workspace }, pluginHost)
    expect(mocks.run.mock.calls[0][1].cwd).toBe(mocks.workspace)
  })

  it('can retry after runtime assembly fails', async () => {
    mocks.runtime.mockImplementationOnce(() => {
      throw new Error('runtime failed')
    })
    const agent = new Agent(sessions as never, pluginHost as never)

    expect(() => agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })).toThrow(
      'runtime failed'
    )
    agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })

    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
  })

  it('reports an error without also ending the stream', async () => {
    const error = new Error('failed')
    mocks.run.mockRejectedValue(error)
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(input, sink)

    await vi.waitFor(() => expect(sink.error).toHaveBeenCalledWith(error))
    expect(sink.end).not.toHaveBeenCalled()
  })

  it('uses a fresh sink for each completed run', async () => {
    const first = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const second = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(input, first)
    await vi.waitFor(() => expect(first.end).toHaveBeenCalledOnce())
    agent.send(input, second)

    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2))
    expect(first.end).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(second.end).toHaveBeenCalledOnce())
  })
})
