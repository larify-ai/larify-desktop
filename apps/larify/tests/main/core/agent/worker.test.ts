import type { UIMessage, UIMessageChunk } from 'ai'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearReadState, markRead, readAtFor } from '../../../../src/extensions/fs/main/state'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('../../../../src/main/core/agent/persist', () => ({
  runStoredAgentSession: mocks.run,
  markNested: (value: UIMessage) => ({
    ...value,
    metadata: { ...(value.metadata as Record<string, unknown> | undefined), nested: true }
  })
}))

import { AgentWorker, type SessionTrack } from '../../../../src/main/core/agent/worker'
import { AgentReview, FileChangeTracker } from '../../../../src/main/core/agent/review'

// Real workspace on disk: the change tracker reconciles tracked files against
// the filesystem, so tool writes must actually land on disk in these tests.
const workspace = mkdtempSync(join(tmpdir(), 'larify-worker-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

const input = {
  sessionId: 'session',
  cwd: workspace,
  message: {
    id: 'user',
    role: 'user',
    parts: [{ type: 'text', text: 'hello' }]
  } as UIMessage,
  runtime: {
    toolsContext: {
      fs_edit: { sessionId: 'session', cwd: workspace },
      fs_write: { sessionId: 'session', cwd: workspace }
    }
  } as never
}

function createWorker(
  track?: SessionTrack,
  mainAssistant?: UIMessage
): {
  worker: AgentWorker
  sessions: {
    loadMessages: ReturnType<typeof vi.fn<() => UIMessage[]>>
    saveMessages: ReturnType<typeof vi.fn>
    saveStart: ReturnType<typeof vi.fn>
    lastAssistant: ReturnType<typeof vi.fn>
  }
  sink: {
    chunk: ReturnType<typeof vi.fn>
    title: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
  pluginHost: { refreshPlugins: ReturnType<typeof vi.fn> }
} {
  const sink = { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
  const sessions = {
    loadMessages: vi.fn<() => UIMessage[]>(() => []),
    saveMessages: vi.fn(),
    saveStart: vi.fn(),
    // 子任务轮的快照写回目标取自「主链 assistant」（见 worker.saveReview）。
    lastAssistant: vi.fn(() => mainAssistant)
  }
  const pluginHost = { refreshPlugins: vi.fn(async () => undefined) }
  return {
    worker: new AgentWorker(sessions as never, sink, pluginHost as never, track),
    sessions,
    sink,
    pluginHost
  }
}

/** 构造一个会话级追踪器（模拟 Agent 中 ask_user 之前的既有状态）。 */
function createTrack(root: string, sink: { chunk: ReturnType<typeof vi.fn> }): SessionTrack {
  return {
    cwd: root,
    review: new AgentReview(root, (chunk) => sink.chunk(chunk)),
    tracker: new FileChangeTracker()
  }
}

beforeEach(() => vi.clearAllMocks())

describe('AgentWorker', () => {
  it('streams one net patch for repeated edits to the same file', async () => {
    const path = join(workspace, 'file.ts')
    writeFileSync(path, 'const value = 1\n')
    const runtime = {
      toolsContext: {
        fs_edit: { sessionId: 'session', cwd: workspace }
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
    const path = join(workspace, 'file.ts')
    writeFileSync(path, 'new\n')
    let emit!: (chunk: UIMessageChunk) => void
    let complete!: () => void
    let trackFileChange!: (mutation: { path: string; before: string | null; after: string }) => void
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
    trackFileChange({ path, before: null, after: 'new\n' })
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
      output: {
        kind: 'diff',
        path,
        patch: '--- a/file.ts\n+++ b/file.ts\n@@ -0,0 +1 @@\n+new'
      }
    } as UIMessageChunk)
    expect(sink.chunk).toHaveBeenCalledWith({
      type: 'data-git-snapshot',
      id: 'review',
      data: {
        root: resolve(workspace),
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

  it('starts a new stored run from the handoff after reset', async () => {
    const runtime = {
      toolsContext: {
        agent_reset_context: { sessionId: 'session', cwd: '/workspace' }
      }
    } as never
    mocks.run
      .mockImplementationOnce(async (_sessions, request) => {
        request.options.toolsContext.agent_reset_context.requestContextReset(
          'Continue from ~/.larify/tasks/demo/task.md.'
        )
        await expect(request.options.stopWhen({ steps: [] })).resolves.toBe(true)
        return undefined
      })
      .mockResolvedValueOnce(undefined)
    const { worker, sessions, sink, pluginHost } = createWorker()

    await worker.run({ ...input, runtime })

    expect(pluginHost.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(mocks.run).toHaveBeenCalledTimes(2)
    const nextMessage = mocks.run.mock.calls[1][1].message
    expect(nextMessage).toMatchObject({
      role: 'user',
      metadata: { compaction: true },
      parts: [
        {
          type: 'text',
          text: 'hello'
        },
        {
          type: 'text',
          text: '# Handoff\n\nContinue from ~/.larify/tasks/demo/task.md.'
        }
      ]
    })
    expect(sessions.saveStart).toHaveBeenCalledWith('session', nextMessage)
    expect(sink.end).toHaveBeenCalledOnce()
  })

  it('routes a child-task snapshot back to the main-chain assistant', async () => {
    // 子任务轮（nested）的落库身份是那条 UI 私有的 `-nested` 行；其变更必须回流到**主链
    // assistant**（卡片只渲染主链消息）——否则「调度任务后变更卡片不更新」。worker 用
    // sessions.lastAssistant(sessionId,'after') 取主链身份作为写回目标。
    const stored: UIMessage = {
      id: 'child-assistant-nested',
      role: 'assistant',
      metadata: { nested: true },
      parts: []
    }
    const mainAssistant: UIMessage = { id: 'main-assistant', role: 'assistant', parts: [] }
    mocks.run.mockImplementation(async () => stored)
    const { sink } = createWorker()
    const track = createTrack(workspace, sink)
    track.review.update({
      path: resolve(join(workspace, 'nested-file.ts')),
      patch: '+nested',
      additions: 1,
      deletions: 0,
      binary: false
    })
    const { worker, sessions } = createWorker(track, mainAssistant)

    await worker.run({ ...input, nested: true })

    const saved = sessions.saveMessages.mock.calls.map((call) => call[1][0] as UIMessage)
    expect(saved).toContainEqual(
      expect.objectContaining({
        id: 'main-assistant',
        parts: [expect.objectContaining({ type: 'data-git-snapshot', id: 'review' })]
      })
    )
    // 绝不把子任务轮的快照写在其自己的 `-nested` 行上（那是卡片看不到的那条）。
    expect(saved.find((message) => message.id === 'child-assistant-nested')).toBeUndefined()
  })

  it('does not tag a top-level response as nested when re-saving the review snapshot', async () => {
    // 顶层轮次：persist 返回原身份，worker 回写不得添加 nested（否则会被 loadMessages 过滤）。
    mocks.run.mockImplementation(
      async () => ({ id: 'top-assistant', role: 'assistant', parts: [] }) as UIMessage
    )
    const { sink } = createWorker()
    const track = createTrack(workspace, sink)
    track.review.update({
      path: resolve(join(workspace, 'top-file.ts')),
      patch: '+top',
      additions: 1,
      deletions: 0,
      binary: false
    })
    const { worker, sessions } = createWorker(track)

    await worker.run(input)

    const lastSaved = sessions.saveMessages.mock.calls.at(-1)?.[1]?.[0] as UIMessage
    expect(lastSaved.id).toBe('top-assistant')
    expect((lastSaved.metadata as Record<string, unknown> | undefined)?.nested).toBeUndefined()
  })

  it('marks the reset handoff as nested during a child task without moving the main-chain start', async () => {
    // 子任务（nested）的 reset 续写：handoff 消息仍打 nested 标记（UI 可见、不进主链上下文）。
    // 但**绝不能**调用 saveStart：`sessions.start` 是主链上下文游标，子任务把它推到自己的位置后，
    // 之后「回主链续跑」时 loadMessages 只会返回子任务之后的残片——主链上下文被清空（实测返回 []）。
    const runtime = {
      toolsContext: {
        agent_reset_context: { sessionId: 'session', cwd: '/workspace' }
      }
    } as never
    mocks.run
      .mockImplementationOnce(async (_sessions, request) => {
        request.options.toolsContext.agent_reset_context.requestContextReset('Continue.')
        return undefined
      })
      .mockResolvedValueOnce(undefined)
    const { worker, sessions } = createWorker()

    await worker.run({ ...input, runtime, nested: true })

    const nextMessage = mocks.run.mock.calls[1][1].message
    expect(nextMessage.metadata).toMatchObject({ compaction: true, nested: true })
    expect(sessions.saveStart).not.toHaveBeenCalled()
  })

  it('still moves the main-chain start for a top-level reset', async () => {
    // 对照：主链轮次的 reset 仍必须 saveStart（截断模型输入，压缩保留）。
    const runtime = {
      toolsContext: {
        agent_reset_context: { sessionId: 'session', cwd: '/workspace' }
      }
    } as never
    mocks.run
      .mockImplementationOnce(async (_sessions, request) => {
        request.options.toolsContext.agent_reset_context.requestContextReset('Continue.')
        return undefined
      })
      .mockResolvedValueOnce(undefined)
    const { worker, sessions } = createWorker()

    await worker.run({ ...input, runtime })

    expect(sessions.saveStart).toHaveBeenCalledWith('session', mocks.run.mock.calls[1][1].message)
  })

  it('clears file read state after reset', async () => {
    const sessionId = 'reset-file-state-session'
    const otherSessionId = 'other-file-state-session'
    const file = '/workspace/file.ts'
    markRead(sessionId, file, 1_000)
    markRead(otherSessionId, file, 2_000)
    const runtime = {
      toolsContext: {
        agent_reset_context: { sessionId, cwd: '/workspace' }
      }
    } as never
    mocks.run
      .mockImplementationOnce(async (_sessions, request) => {
        request.options.toolsContext.agent_reset_context.requestContextReset('Continue fresh.')
        return undefined
      })
      .mockImplementationOnce(async () => {
        expect(readAtFor(sessionId, file)).toBeUndefined()
        expect(readAtFor(otherSessionId, file)).toBe(2_000)
        return undefined
      })
    const { worker, pluginHost } = createWorker()

    await worker.run({ ...input, sessionId, runtime })

    expect(pluginHost.refreshPlugins).toHaveBeenCalledTimes(1)
    expect(mocks.run).toHaveBeenCalledTimes(2)
    expect(readAtFor(sessionId, file)).toBeUndefined()
    expect(readAtFor(otherSessionId, file)).toBe(2_000)
    clearReadState(otherSessionId)
  })

  it('keeps file read state when the context is not reset', async () => {
    const sessionId = 'preserved-file-state-session'
    const file = '/workspace/file.ts'
    markRead(sessionId, file, 1_000)
    mocks.run.mockResolvedValueOnce(undefined)
    const { worker } = createWorker()

    await worker.run({ ...input, sessionId })

    expect(readAtFor(sessionId, file)).toBe(1_000)
    clearReadState(sessionId)
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

  it('keeps earlier files when the same task writes more files in a continuation', async () => {
    // ask_user 前已修改 existing.ts（会话级 track 中有记录）；用户回答后同一任务
    // （复用同一个 track）又改了 new.ts。期望：快照包含旧文件 + 新文件。
    const followPath = join(workspace, 'new.ts')
    writeFileSync(followPath, 'new\n')
    mocks.run.mockImplementation(async (_sessions, request) => {
      const context = request.options.toolsContext.fs_write as {
        trackFileChange: (mutation: { path: string; before: string | null; after: string }) => void
      }
      context.trackFileChange({ path: followPath, before: null, after: 'new\n' })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'write',
        toolName: 'fs_write'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'write',
        output: { kind: 'diff', path: followPath, patch: '+new' }
      } as UIMessageChunk)
      return { id: 'assistant', role: 'assistant', parts: [] } as UIMessage
    })
    const { sink } = createWorker()
    const track = createTrack(workspace, sink)
    track.review.update({
      path: resolve(join(workspace, 'existing.ts')),
      patch: '+old',
      additions: 1,
      deletions: 0,
      binary: false
    })
    const { worker: continuationWorker } = createWorker(track)

    await continuationWorker.run({
      ...input,
      runtime: {
        toolsContext: { fs_write: { sessionId: 'session', cwd: workspace } }
      } as never
    })

    const snapshots = sink.chunk.mock.calls
      .map(([chunk]) => chunk)
      .filter((chunk) => chunk.type === 'data-git-snapshot')
    const last = snapshots.at(-1)
    expect(last).toBeDefined()
    expect(last.data.files.map((file: { path: string }) => file.path).sort()).toEqual([
      'existing.ts',
      'new.ts'
    ])
  })

  it('persists the task snapshot when a continuation makes no changes', async () => {
    // 会话级 track 已含第一轮修改的文件；本轮（ask_user 回答后）没有任何文件变更。
    // 期望：最终保存的消息仍带快照 part（同一任务，不能因为本轮无改动而丢失）。
    mocks.run.mockImplementation(
      async () => ({ id: 'assistant', role: 'assistant', parts: [] }) as UIMessage
    )
    const { sink } = createWorker()
    const track = createTrack('/workspace', sink)
    track.review.update({
      path: resolve('/workspace/file.ts'),
      patch: '+change',
      additions: 1,
      deletions: 0,
      binary: false
    })
    const { worker: continuationWorker, sessions } = createWorker(track)

    await continuationWorker.run(input)

    const lastSaved = sessions.saveMessages.mock.calls.at(-1)?.[1]?.[0] as UIMessage | undefined
    expect(lastSaved).toBeDefined()
    expect(lastSaved?.parts).toContainEqual(
      expect.objectContaining({ type: 'data-git-snapshot', id: 'review' })
    )
  })

  it('streams and persists successful tool diffs', async () => {
    const path = join(workspace, 'file.ts')
    writeFileSync(path, 'change\n')
    const response: UIMessage = { id: 'assistant', role: 'assistant', parts: [] }
    mocks.run.mockImplementation(async (_sessions, request) => {
      request.options.toolsContext.fs_write.trackFileChange({
        path,
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
          path,
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
        root: resolve(workspace),
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

  it('reflects a file deleted after the last tool output in the final card', async () => {
    const path = join(workspace, 'existing.ts')
    writeFileSync(path, 'old\n')
    mocks.run.mockImplementation(async (_sessions, request) => {
      request.options.toolsContext.fs_write.trackFileChange({
        path,
        before: 'old\n',
        after: 'new\n'
      })
      request.onChunk({
        type: 'tool-input-start',
        toolCallId: 'write',
        toolName: 'fs_write'
      } as UIMessageChunk)
      request.onChunk({
        type: 'tool-output-available',
        toolCallId: 'write',
        output: { kind: 'diff', path, patch: '-old\n+new' }
      } as UIMessageChunk)
      // Deleted outside the tracked tools after the final tool output.
      rmSync(path)
      return { id: 'assistant', role: 'assistant', parts: [] } as UIMessage
    })
    const { worker, sessions, sink } = createWorker()

    await worker.run(input)

    const snapshots = sink.chunk.mock.calls
      .map(([chunk]) => chunk)
      .filter((chunk) => chunk.type === 'data-git-snapshot')
    const last = snapshots.at(-1)
    expect(last).toMatchObject({
      data: {
        files: [
          expect.objectContaining({
            path: 'existing.ts',
            additions: 0,
            deletions: 1
          })
        ]
      }
    })
    const lastSaved = sessions.saveMessages.mock.calls.at(-1)?.[1]?.[0] as UIMessage | undefined
    expect(lastSaved?.parts).toContainEqual(
      expect.objectContaining({ type: 'data-git-snapshot', id: 'review' })
    )
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
