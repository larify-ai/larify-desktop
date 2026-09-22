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
// 全量快照服务在 Agent 运行时真实建立基线并捕获工作区；agent 单元测试聚焦
// 装配/续写/复用逻辑，故把快照服务 mock 掉：start/compare 都视为"无变更"，
// saveReview 走增量兜底路径，行为与接入前一致。
vi.mock('../../../../src/main/core/git/snapshot', () => ({
  GitSnapshotService: class {
    start = vi.fn(async () => null)
    compare = vi.fn(async () => null)
  }
}))

import { Agent } from '../../../../src/main/core/agent/agent'

const message: UIMessage = {
  id: 'message',
  role: 'user',
  parts: [{ type: 'text', text: 'hello' }]
}

const input = { sessionId: 'session', message, cwd: 'cwd' }

/** `runStoredAgentSession` 的返回契约：落库身份 + 卡片目标行（id 与内容基线同源，见 persist.ts）。 */
const stored = (value: UIMessage | undefined) =>
  value === undefined
    ? undefined
    : { stored: value, reviewRowId: value.id, reviewRow: value }

const sessions = {
  loadMessages: vi.fn(() => []),
  saveMessages: vi.fn(),
  saveStart: vi.fn(),
  // awaitUserAnswer / resumed 恢复都依赖 lastMessage（**不过滤 nested**）。
  // 默认返回 undefined = 未停在 ask_user 等待态（普通轮次）。
  lastMessage: vi.fn(() => undefined),
  lastAssistant: vi.fn(() => undefined),
  // resumed 归属恢复会按送来的 ask_user.toolCallId 精确回溯承载者；默认找不到 → 走旧判据。
  findAskUserContext: vi.fn(() => undefined)
}
const pluginHost = { refreshPlugins: vi.fn(async () => undefined) }

beforeEach(() => {
  vi.clearAllMocks()
  sessions.loadMessages.mockReturnValue([])
  sessions.lastMessage.mockReturnValue(undefined)
  sessions.lastAssistant.mockReturnValue(undefined)
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
    // send() 现在是 async：重复发送在 async 体内同步 throw，表现为 Promise 拒绝。
    await expect(
      agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })
    ).rejects.toThrow('Agent is already running.')
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

  it('awaits the plugin refresh BEFORE assembling the runtime so new MCP tools are picked up', async () => {
    const order: string[] = []
    pluginHost.refreshPlugins.mockImplementation(async () => {
      order.push('refresh')
    })
    mocks.runtime.mockImplementation(() => {
      order.push('runtime')
      return { system: 'runtime', toolsContext: {} }
    })
    const agent = new Agent(sessions as never, pluginHost as never)

    // 用 assistant 续写消息，模拟 ask_user 回答后的新一轮 send()。
    const continuation: UIMessage = {
      id: 'assistant-continuation',
      role: 'assistant',
      parts: [{ type: 'text', text: 'continue' }]
    }
    await agent.send(
      { ...input, message: continuation },
      {
        chunk: vi.fn(),
        error: vi.fn(),
        end: vi.fn()
      }
    )

    // 关键顺序：先 refreshPlugins（发现/激活新 MCP），再 createAgentRuntime（收集工具集）。
    // 否则 agent 装了/新装了 MCP 后，ask_user 续写（新 send()）的工具集不会包含新工具。
    expect(order).toEqual(['refresh', 'runtime'])
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

    // send() 是 async：装配失败表现为 Promise 拒绝；worker 已清理，可重试。
    await expect(
      agent.send(input, { chunk: vi.fn(), error: vi.fn(), end: vi.fn() })
    ).rejects.toThrow('runtime failed')
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
      return stored({ id: 'assistant', role: 'assistant', parts: [] })
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
      return stored({ id: 'assistant', role: 'assistant', parts: [] })
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
      return stored({ id: 'assistant', role: 'assistant', parts: [] })
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
      return stored({ id: 'assistant-2', role: 'assistant', parts: [] })
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
      return stored({ id: 'assistant', role: 'assistant', parts: [] })
    })
    // 第二轮：ask_user 续写，无任何文件变更。
    mocks.run.mockImplementationOnce(async () =>
      stored({ id: 'assistant', role: 'assistant', parts: [] })
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

    const lastSaved = sessions.saveMessages.mock.calls.at(-1)?.[1]?.[0] as UIMessage | undefined
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
