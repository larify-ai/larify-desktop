import type { UIMessage, UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('../../../../src/main/core/agent/persist', () => ({
  runStoredAgentSession: mocks.run
}))

import { AgentWorker } from '../../../../src/main/core/agent/worker'

const input = {
  sessionId: 'session',
  cwd: '/workspace',
  message: {
    id: 'user',
    role: 'user',
    parts: [{ type: 'text', text: 'hello' }]
  } as UIMessage,
  runtime: {} as never
}

function createWorker(): {
  worker: AgentWorker
  sink: {
    chunk: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
} {
  const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
  return { worker: new AgentWorker({} as never, sink), sink }
}

beforeEach(() => vi.clearAllMocks())

describe('AgentWorker', () => {
  it('forwards chunks and ends after successful execution', async () => {
    const chunk = { type: 'finish' } as UIMessageChunk
    mocks.run.mockImplementation(async (_sessions, request) => request.onChunk(chunk))
    const { worker, sink } = createWorker()

    await worker.run(input)

    expect(sink.chunk).toHaveBeenCalledWith(chunk)
    expect(sink.end).toHaveBeenCalledOnce()
    expect(sink.error).not.toHaveBeenCalled()
  })

  it('reports execution errors without ending', async () => {
    const error = new Error('failed')
    mocks.run.mockRejectedValue(error)
    const { worker, sink } = createWorker()

    await worker.run(input)

    expect(sink.error).toHaveBeenCalledWith(error)
    expect(sink.end).not.toHaveBeenCalled()
  })

  it('ends and closes exactly once when cancelled', async () => {
    mocks.run.mockImplementation(async (_sessions, request) => {
      await new Promise<void>((resolve) =>
        request.options.abortSignal.addEventListener('abort', () => resolve())
      )
    })
    const { worker, sink } = createWorker()

    const running = worker.run(input)
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    worker.cancel()
    worker.cancel()

    await running
    expect(sink.end).toHaveBeenCalledOnce()
    expect(sink.error).not.toHaveBeenCalled()
  })

  it('ignores chunks emitted after cancellation', async () => {
    let emit!: (chunk: UIMessageChunk) => void
    mocks.run.mockImplementation(async (_sessions, request) => {
      emit = request.onChunk
      await new Promise<void>((resolve) =>
        request.options.abortSignal.addEventListener('abort', () => resolve())
      )
    })
    const { worker, sink } = createWorker()

    const running = worker.run(input)
    await vi.waitFor(() => expect(emit).toBeDefined())
    worker.cancel()
    emit({ type: 'finish' } as UIMessageChunk)

    expect(sink.chunk).not.toHaveBeenCalled()
    await running
  })

  it('cannot be run again after completion', async () => {
    mocks.run.mockResolvedValue(undefined)
    const { worker, sink } = createWorker()

    await worker.run(input)
    await worker.run(input)

    expect(mocks.run).toHaveBeenCalledOnce()
    expect(sink.end).toHaveBeenCalledOnce()
  })
})
