import type { UIMessage, UIMessageChunk } from 'ai'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Real workspace on disk: the change tracker reconciles tracked files against
// the filesystem, so tool writes must actually land on disk in these tests.
const workspace = mkdtempSync(join(tmpdir(), 'larify-agent-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  runtime: vi.fn(),
  workspace: 'default-workspace',
  larifyRoot: '~/.larify/'
}))

vi.mock('../../../../src/main/core/agent/persist', () => ({
  runStoredAgentSession: mocks.run
}))
vi.mock('../../../../src/main/core/agent/runtime', () => ({
  createAgentRuntime: mocks.runtime
}))
vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyPath: (...segments: string[]) => mocks.larifyRoot + segments.join('/'),
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
  loadMessages: vi.fn(() => []),
  saveMessages: vi.fn(),
  saveStart: vi.fn()
}
const pluginHost = { refreshPlugins: vi.fn(async () => undefined) }

beforeEach(() => {
  vi.clearAllMocks()
  sessions.loadMessages.mockReturnValue([])
  mocks.run.mockResolvedValue(undefined)
  mocks.runtime.mockReturnValue({ system: 'runtime', toolsContext: {} })
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

  it('keeps file tracking across an ask user continuation', async () => {
    const existingPath = join(workspace, 'existing.ts')
    const newPath = join(workspace, 'new.ts')
    writeFileSync(existingPath, 'old\n')
    writeFileSync(newPath, 'new\n')
    // 第一轮（用户提问）：修改 existing.ts。
    mocks.run.mockImplementationOnce(async (_sessions, request) => {
      const context = request.options.toolsContext.fs_write as {
        trackFileChange: (mutation: { path: string; before: string | null; after: string }) => void
      }
      context.trackFileChange({
        path: existingPath,
        before: null,
        after: 'old\n'
      })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'write-1',
        toolName: 'fs_write'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'write-1',
        output: { kind: 'diff', path: join(workspace, 'existing.ts'), patch: '+old' }
      } as UIMessageChunk)
      return { id: 'assistant', role: 'assistant', parts: [] } as UIMessage
    })
    // 第二轮（ask_user 回答后，同一任务续写）：只改 new.ts。
    mocks.run.mockImplementationOnce(async (_sessions, request) => {
      const context = request.options.toolsContext.fs_write as {
        trackFileChange: (mutation: { path: string; before: string | null; after: string }) => void
      }
      context.trackFileChange({
        path: newPath,
        before: null,
        after: 'new\n'
      })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'write-2',
        toolName: 'fs_write'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'write-2',
        output: { kind: 'diff', path: join(workspace, 'new.ts'), patch: '+new' }
      } as UIMessageChunk)
      return { id: 'assistant', role: 'assistant', parts: [] } as UIMessage
    })
    mocks.runtime.mockReturnValue({
      system: 'runtime',
      toolsContext: { fs_write: { sessionId: 'session', cwd: 'cwd' } }
    })
    const continuation: UIMessage = {
      id: 'assistant-continuation',
      role: 'assistant',
      parts: [{ type: 'text', text: 'continuing after ask user' }]
    }
    const first = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const second = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ ...input, cwd: workspace }, first)
    await vi.waitFor(() => expect(first.end).toHaveBeenCalledOnce())
    agent.send({ ...input, cwd: workspace, message: continuation }, second)
    await vi.waitFor(() => expect(second.end).toHaveBeenCalledOnce())

    const snapshots = second.chunk.mock.calls
      .map(([chunk]) => chunk)
      .filter((chunk) => chunk.type === 'data-git-snapshot')
    const last = snapshots.at(-1)
    expect(last).toBeDefined()
    expect(last.data.files.map((file: { path: string }) => file.path).sort()).toEqual([
      'existing.ts',
      'new.ts'
    ])
  })

  it('resets file tracking when a new user request starts', async () => {
    const existingPath = join(workspace, 'existing.ts')
    const otherPath = join(workspace, 'other.ts')
    writeFileSync(existingPath, 'old\n')
    writeFileSync(otherPath, 'other\n')
    // 第一轮（user 请求）：修改 existing.ts。
    mocks.run.mockImplementationOnce(async (_sessions, request) => {
      const context = request.options.toolsContext.fs_write as {
        trackFileChange: (mutation: { path: string; before: string | null; after: string }) => void
      }
      context.trackFileChange({
        path: existingPath,
        before: null,
        after: 'old\n'
      })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'write-1',
        toolName: 'fs_write'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'write-1',
        output: { kind: 'diff', path: join(workspace, 'existing.ts'), patch: '+old' }
      } as UIMessageChunk)
      return { id: 'assistant', role: 'assistant', parts: [] } as UIMessage
    })
    // 第二轮：全新用户请求（新任务）→ 追踪器必须重置，不能再带出上一任务的文件。
    mocks.run.mockImplementationOnce(async (_sessions, request) => {
      const context = request.options.toolsContext.fs_write as {
        trackFileChange: (mutation: { path: string; before: string | null; after: string }) => void
      }
      context.trackFileChange({
        path: otherPath,
        before: null,
        after: 'other\n'
      })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'write-2',
        toolName: 'fs_write'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'write-2',
        output: { kind: 'diff', path: otherPath, patch: '+other' }
      } as UIMessageChunk)
      return { id: 'assistant-2', role: 'assistant', parts: [] } as UIMessage
    })
    mocks.runtime.mockReturnValue({
      system: 'runtime',
      toolsContext: { fs_write: { sessionId: 'session', cwd: 'cwd' } }
    })
    const first = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const second = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ ...input, cwd: workspace }, first)
    await vi.waitFor(() => expect(first.end).toHaveBeenCalledOnce())
    agent.send({ ...input, cwd: workspace }, second)
    await vi.waitFor(() => expect(second.end).toHaveBeenCalledOnce())

    const snapshots = second.chunk.mock.calls
      .map(([chunk]) => chunk)
      .filter((chunk) => chunk.type === 'data-git-snapshot')
    const last = snapshots.at(-1)
    expect(last.data.files.map((file: { path: string }) => file.path)).toEqual(['other.ts'])
  })

  it('keeps the persisted snapshot when a continuation changes no files', async () => {
    const existingPath = join(workspace, 'existing.ts')
    writeFileSync(existingPath, 'old\n')
    // 第一轮（user）：修改 existing.ts。
    mocks.run.mockImplementationOnce(async (_sessions, request) => {
      const context = request.options.toolsContext.fs_write as {
        trackFileChange: (mutation: { path: string; before: string | null; after: string }) => void
      }
      context.trackFileChange({
        path: existingPath,
        before: null,
        after: 'old\n'
      })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'write-1',
        toolName: 'fs_write'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'write-1',
        output: { kind: 'diff', path: join(workspace, 'existing.ts'), patch: '+old' }
      } as UIMessageChunk)
      return { id: 'assistant', role: 'assistant', parts: [] } as UIMessage
    })
    // 第二轮：ask_user 续写，无任何文件变更。
    mocks.run.mockImplementationOnce(
      async () => ({ id: 'assistant', role: 'assistant', parts: [] }) as UIMessage
    )
    mocks.runtime.mockReturnValue({
      system: 'runtime',
      toolsContext: { fs_write: { sessionId: 'session', cwd: 'cwd' } }
    })
    const first = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const second = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ ...input, cwd: workspace }, first)
    await vi.waitFor(() => expect(first.end).toHaveBeenCalledOnce())
    agent.send(
      {
        ...input,
        cwd: workspace,
        message: {
          id: 'assistant-continuation',
          role: 'assistant',
          parts: [{ type: 'text', text: 'continue' }]
        }
      },
      second
    )
    await vi.waitFor(() => expect(second.end).toHaveBeenCalledOnce())

    const lastSaved = sessions.saveMessages.mock.calls.at(-1)?.[1]?.[0] as
      | UIMessage
      | undefined
    expect(lastSaved?.parts).toContainEqual(
      expect.objectContaining({ type: 'data-git-snapshot', id: 'review' })
    )
  })

  it('runs different sessions concurrently and cancels all of them on disposal', async () => {
    const signals = new Map<string, AbortSignal>()
    mocks.run.mockImplementation(async (_sessions, request) => {
      const signal = request.options.abortSignal as AbortSignal
      signals.set(request.sessionId, signal)
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
      return undefined
    })
    const first = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const second = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ ...input, sessionId: 'first' }, first)
    agent.send({ ...input, sessionId: 'second' }, second)
    await vi.waitFor(() => expect(signals.size).toBe(2))
    agent.dispose()

    expect(signals.get('first')?.aborted).toBe(true)
    expect(signals.get('second')?.aborted).toBe(true)
    expect(first.end).toHaveBeenCalledOnce()
    expect(second.end).toHaveBeenCalledOnce()
  })
})
