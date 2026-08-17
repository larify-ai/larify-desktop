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
  sessions: { saveMessages: ReturnType<typeof vi.fn> }
  snapshots: { start: ReturnType<typeof vi.fn>; compare: ReturnType<typeof vi.fn> }
  sink: {
    chunk: ReturnType<typeof vi.fn>
    title: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
} {
  const sink = { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
  const sessions = { saveMessages: vi.fn() }
  const snapshots = {
    start: vi.fn().mockResolvedValue(null),
    compare: vi.fn().mockResolvedValue(null)
  }
  return {
    worker: new AgentWorker(sessions as never, snapshots as never, sink),
    sessions,
    snapshots,
    sink
  }
}

beforeEach(() => vi.clearAllMocks())

describe('AgentWorker', () => {
  it('updates a live review only after successful fs_write and fs_edit calls', async () => {
    vi.useFakeTimers()
    try {
      let emit!: (chunk: UIMessageChunk) => void
      let complete!: () => void
      mocks.run.mockImplementation(
        (_sessions, request) =>
          new Promise<UIMessage | undefined>((resolve) => {
            emit = request.onChunk
            complete = () => resolve(undefined)
          })
      )
      const { worker, snapshots } = createWorker()
      snapshots.start.mockResolvedValue({ tree: 'before' })
      const running = worker.run(input)
      await vi.waitFor(() => expect(emit).toBeDefined())

      emit({ type: 'tool-input-start', toolCallId: 'read', toolName: 'fs_read' } as UIMessageChunk)
      emit({ type: 'tool-output-available', toolCallId: 'read', output: 'text' } as UIMessageChunk)
      emit({
        type: 'tool-input-available',
        toolCallId: 'write',
        toolName: 'fs_write',
        input: {}
      } as UIMessageChunk)
      emit({
        type: 'tool-output-available',
        toolCallId: 'write',
        output: 'pending',
        preliminary: true
      } as UIMessageChunk)
      await vi.advanceTimersByTimeAsync(200)
      expect(snapshots.compare).not.toHaveBeenCalled()

      emit({ type: 'tool-output-available', toolCallId: 'write', output: 'done' } as UIMessageChunk)
      await vi.advanceTimersByTimeAsync(200)
      expect(snapshots.compare).toHaveBeenCalledOnce()

      emit({ type: 'tool-input-start', toolCallId: 'edit', toolName: 'fs_edit' } as UIMessageChunk)
      emit({ type: 'tool-output-error', toolCallId: 'edit', errorText: 'failed' } as UIMessageChunk)
      await vi.advanceTimersByTimeAsync(200)
      expect(snapshots.compare).toHaveBeenCalledOnce()

      complete()
      await running
      expect(snapshots.compare).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('forwards chunks and ends after successful execution', async () => {
    const chunk = { type: 'finish' } as UIMessageChunk
    mocks.run.mockImplementation(async (_sessions, request) => {
      request.onChunk(chunk)
      return undefined
    })
    const { worker, sink } = createWorker()

    await worker.run(input)

    expect(sink.chunk).toHaveBeenCalledWith(chunk)
    expect(sink.end).toHaveBeenCalledOnce()
    expect(sink.error).not.toHaveBeenCalled()
  })

  it('forwards generated titles while running', async () => {
    mocks.run.mockImplementation(async (_sessions, request) => {
      request.onTitle('Generated title')
      return undefined
    })
    const { worker, sink } = createWorker()

    await worker.run(input)

    expect(sink.title).toHaveBeenCalledWith('Generated title')
  })

  it('reports execution errors without ending', async () => {
    const error = new Error('failed')
    mocks.run.mockRejectedValue(error)
    const { worker, sink } = createWorker()

    await worker.run(input)

    expect(sink.error).toHaveBeenCalledWith(error)
    expect(sink.end).not.toHaveBeenCalled()
  })

  it('cancels a pending review update after an execution error', async () => {
    vi.useFakeTimers()
    try {
      const error = new Error('failed')
      mocks.run.mockImplementation(async (_sessions, request) => {
        request.onChunk({
          type: 'tool-output-available',
          toolCallId: 'call',
          output: 'done'
        } as UIMessageChunk)
        throw error
      })
      const { worker, snapshots, sink } = createWorker()
      snapshots.start.mockResolvedValue({ tree: 'before' })

      await worker.run(input)
      await vi.advanceTimersByTimeAsync(200)

      expect(sink.error).toHaveBeenCalledWith(error)
      expect(snapshots.compare).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('streams and persists the final review snapshot', async () => {
    const response: UIMessage = { id: 'assistant', role: 'assistant', parts: [] }
    const snapshot = {
      files: [{ additions: 1, deletions: 0, path: 'file.ts', patch: '+change' }],
      root: '/workspace'
    }
    mocks.run.mockResolvedValue(response)
    const { worker, sessions, snapshots, sink } = createWorker()
    snapshots.start.mockResolvedValue({ tree: 'before' })
    snapshots.compare.mockResolvedValue(snapshot)

    await worker.run(input)

    const part = { type: 'data-git-snapshot', id: 'review', data: snapshot }
    expect(sink.chunk).toHaveBeenCalledWith(part)
    expect(sessions.saveMessages).toHaveBeenCalledWith('session', [{ ...response, parts: [part] }])
  })

  it('ends and closes exactly once when cancelled', async () => {
    mocks.run.mockImplementation(async (_sessions, request) => {
      await new Promise<void>((resolve) =>
        request.options.abortSignal.addEventListener('abort', () => resolve())
      )
      return undefined
    })
    const { worker, sessions, snapshots, sink } = createWorker()
    snapshots.start.mockResolvedValue({ tree: 'before' })
    snapshots.compare.mockResolvedValue({
      files: [{ additions: 1, deletions: 0, path: 'cancelled.ts', patch: '+cancelled' }]
    })

    const running = worker.run(input)
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    worker.cancel()
    worker.cancel()

    await running
    expect(sink.end).toHaveBeenCalledOnce()
    expect(sink.error).not.toHaveBeenCalled()
    expect(snapshots.compare).not.toHaveBeenCalled()
    expect(sessions.saveMessages).not.toHaveBeenCalled()
  })

  it('does not start the agent session when cancelled during snapshot setup', async () => {
    let resolveStart!: (value: { tree: string }) => void
    const start = new Promise<{ tree: string }>((resolve) => {
      resolveStart = resolve
    })
    const { worker, snapshots, sink } = createWorker()
    snapshots.start.mockReturnValue(start)

    const running = worker.run(input)
    await vi.waitFor(() => expect(snapshots.start).toHaveBeenCalledOnce())
    worker.cancel()
    resolveStart({ tree: 'before' })
    await running

    expect(mocks.run).not.toHaveBeenCalled()
    expect(snapshots.compare).not.toHaveBeenCalled()
    expect(sink.end).toHaveBeenCalledOnce()
  })

  it('ignores chunks emitted after cancellation', async () => {
    let emit!: (chunk: UIMessageChunk) => void
    mocks.run.mockImplementation(async (_sessions, request) => {
      emit = request.onChunk
      await new Promise<void>((resolve) =>
        request.options.abortSignal.addEventListener('abort', () => resolve())
      )
      return undefined
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
