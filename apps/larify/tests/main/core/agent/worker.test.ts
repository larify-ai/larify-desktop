import type { UIMessage, UIMessageChunk } from 'ai'
import { resolve } from 'node:path'
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
  runtime: {
    toolsContext: {
      fs_edit: { sessionId: 'session', cwd: '/workspace' },
      fs_write: { sessionId: 'session', cwd: '/workspace' }
    }
  } as never
}

function createWorker(): {
  worker: AgentWorker
  sessions: { saveMessages: ReturnType<typeof vi.fn> }
  sink: {
    chunk: ReturnType<typeof vi.fn>
    title: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
} {
  const sink = { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
  const sessions = { saveMessages: vi.fn() }
  return {
    worker: new AgentWorker(sessions as never, sink),
    sessions,
    sink
  }
}

beforeEach(() => vi.clearAllMocks())

describe('AgentWorker', () => {
  it('streams one net patch for repeated edits to the same file', async () => {
    const path = '/workspace/file.ts'
    const runtime = {
      toolsContext: {
        fs_edit: { sessionId: 'session', cwd: '/workspace' }
      }
    } as never
    mocks.run.mockImplementation(async (_sessions, request) => {
      const context = request.options.toolsContext.fs_edit as {
        trackFileChange: (mutation: { path: string; before: string; after: string }) => void
      }
      context.trackFileChange({ path, before: 'const value = 1\n', after: 'const value = 2\n' })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'first',
        toolName: 'fs_edit'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'first',
        output: { kind: 'diff', path, patch: '-const value = 1\n+const value = 2' }
      } as UIMessageChunk)
      context.trackFileChange({ path, before: 'const value = 2\n', after: 'const value = 3\n' })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'second',
        toolName: 'fs_edit'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'second',
        output: { kind: 'diff', path, patch: '-const value = 2\n+const value = 3' }
      } as UIMessageChunk)
      return undefined
    })
    const { worker, sink } = createWorker()

    await worker.run({ ...input, runtime })

    const reviewUpdates = sink.chunk.mock.calls
      .map(([chunk]) => chunk)
      .filter((chunk) => chunk.type === 'data-git-snapshot')
    expect(reviewUpdates).toHaveLength(2)
    expect(reviewUpdates.at(-1)).toMatchObject({
      data: {
        files: [
          {
            path: 'file.ts',
            additions: 1,
            deletions: 1,
            patch: expect.stringContaining('-const value = 1')
          }
        ]
      }
    })
    expect(reviewUpdates.at(-1).data.files[0].patch).toContain('+const value = 3')
    expect(reviewUpdates.at(-1).data.files[0].patch).not.toContain('const value = 2')
  })

  it('updates a live review only after successful fs_write and fs_edit calls', async () => {
    let emit!: (chunk: UIMessageChunk) => void
    let complete!: () => void
    let trackFileChange!: (mutation: {
      path: string
      before: string | null
      after: string
    }) => void
    mocks.run.mockImplementation(
      (_sessions, request) =>
        new Promise<UIMessage | undefined>((resolve) => {
          emit = request.onChunk
          trackFileChange = request.options.toolsContext.fs_write.trackFileChange
          complete = () => resolve(undefined)
        })
    )
    const { worker, sink } = createWorker()
    const running = worker.run(input)
    await vi.waitFor(() => expect(emit).toBeDefined())

    emit({ type: 'tool-input-start', toolCallId: 'read', toolName: 'fs_read' } as UIMessageChunk)
    emit({ type: 'tool-output-available', toolCallId: 'read', output: 'text' } as UIMessageChunk)
    trackFileChange({ path: '/workspace/file.ts', before: null, after: 'new\n' })
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
    expect(sink.chunk).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'data-git-snapshot' })
    )

    emit({
      type: 'tool-output-available',
      toolCallId: 'write',
      output: { kind: 'diff', path: '/workspace/file.ts', patch: '--- a/file.ts\n+++ b/file.ts\n@@ -0,0 +1 @@\n+new' }
    } as UIMessageChunk)
    expect(sink.chunk).toHaveBeenCalledWith({
      type: 'data-git-snapshot',
      id: 'review',
      data: {
        root: resolve('/workspace'),
        files: [
          {
            path: 'file.ts',
            patch: expect.stringContaining('+new'),
            additions: 1,
            deletions: 0,
            binary: false
          }
        ]
      }
    })

    emit({ type: 'tool-input-start', toolCallId: 'edit', toolName: 'fs_edit' } as UIMessageChunk)
    emit({ type: 'tool-output-error', toolCallId: 'edit', errorText: 'failed' } as UIMessageChunk)

    complete()
    await running
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

  it('streams and persists successful tool diffs', async () => {
    const response: UIMessage = { id: 'assistant', role: 'assistant', parts: [] }
    mocks.run.mockImplementation(async (_sessions, request) => {
      request.options.toolsContext.fs_write.trackFileChange({
        path: '/workspace/file.ts',
        before: null,
        after: 'change\n'
      })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'write',
        toolName: 'fs_write'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'write',
        output: {
          kind: 'diff',
          path: '/workspace/file.ts',
          patch: '--- a/file.ts\n+++ b/file.ts\n@@ -0,0 +1 @@\n+change'
        }
      } as UIMessageChunk)
      return response
    })
    const { worker, sessions, sink } = createWorker()

    await worker.run(input)

    const part = sink.chunk.mock.calls
      .map(([chunk]) => chunk)
      .find((chunk) => chunk.type === 'data-git-snapshot')
    expect(part).toMatchObject({
      type: 'data-git-snapshot',
      id: 'review',
      data: {
        root: resolve('/workspace'),
        files: [
          {
            additions: 1,
            deletions: 0,
            path: 'file.ts',
            patch: expect.stringContaining('+change'),
            binary: false
          }
        ]
      }
    })
    expect(sessions.saveMessages).toHaveBeenCalledWith('session', [{ ...response, parts: [part] }])
  })

  it('ends and closes exactly once when cancelled', async () => {
    mocks.run.mockImplementation(async (_sessions, request) => {
      await new Promise<void>((resolve) =>
        request.options.abortSignal.addEventListener('abort', () => resolve())
      )
      return undefined
    })
    const { worker, sessions, sink } = createWorker()

    const running = worker.run(input)
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    worker.cancel()
    worker.cancel()

    await running
    expect(sink.end).toHaveBeenCalledOnce()
    expect(sink.error).not.toHaveBeenCalled()
    expect(sessions.saveMessages).not.toHaveBeenCalled()
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
