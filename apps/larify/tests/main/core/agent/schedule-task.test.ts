import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const home = mkdtempSync(join(tmpdir(), 'larify-schedule-'))
process.env.LARIFY_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  runtime: vi.fn(),
  refreshPlugins: vi.fn()
}))

vi.mock('../../../../src/main/core/agent/persist', () => ({
  runStoredAgentSession: mocks.run
}))
vi.mock('../../../../src/main/core/agent/runtime', () => ({
  createAgentRuntime: mocks.runtime
}))

import { Agent } from '../../../../src/main/core/agent/agent'

const message: UIMessage = {
  id: 'message',
  role: 'user',
  parts: [{ type: 'text', text: 'research' }]
}

const sessions = {
  loadMessages: vi.fn(() => []),
  saveMessages: vi.fn(),
  saveStart: vi.fn(),
  countMessages: vi.fn(() => 0)
}
const pluginHost = { refreshPlugins: mocks.refreshPlugins }

const taskRoot = join(home, '.larify', 'tasks')

beforeEach(() => {
  vi.clearAllMocks()
  sessions.loadMessages.mockReturnValue([])
  mocks.run.mockResolvedValue(undefined)
  mocks.runtime.mockReturnValue({
    system: 'runtime',
    toolsContext: { agent_schedule_task: { sessionId: 'session', cwd: 'cwd' } }
  })
})

describe('Agent scheduled tasks', () => {
  it('runs a top-level task on the main chain, deeper tasks nested, and ends when none is scheduled', async () => {
    // run1 主任务调度【顶层任务】→ run2 主链续跑（nested=false, message=undefined）
    // run2 调度【更深的子任务】→ run3 下探（nested=true, nest 判据）
    // run3 调度【顶层任务】（回父）→ run4 回到主链续跑
    // run4 不再调度 → 结束。
    // 顶层任务路径故意用正斜杠（模型常见写法），验证分隔符归一化后仍判为顶层。
    const top = `${taskRoot.replaceAll('\\', '/')}/root/task.md`
    const child = join(taskRoot, 'root', 'child', 'task.md')
    const phases: Array<{ nested?: boolean; hasMessage: boolean }> = []
    let runs = 0
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      phases.push({ nested: request.nested, hasMessage: request.message !== undefined })
      const context = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (path: string) => void
      }
      if (runs === 1) context.scheduleTask(top)
      else if (runs === 2) context.scheduleTask(child)
      else if (runs === 3) context.scheduleTask(top)
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ sessionId: 'session', message, cwd: 'cwd' }, sink)

    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledOnce())
    expect(runs).toBe(4)
    // run1 主任务；run2 顶层任务→主链续跑（无新消息）；run3 子任务→独立(有 nest 消息)；run4 顶层→主链续跑。
    expect(phases[0]).toEqual({ nested: false, hasMessage: true })
    expect(phases[1]).toEqual({ nested: false, hasMessage: false })
    expect(phases[2]).toEqual({ nested: true, hasMessage: true })
    expect(phases[3]).toEqual({ nested: false, hasMessage: false })
  })

  it('honors only the first task when the model schedules more than one in a turn', async () => {
    // 一轮多调度属违规（同一响应里并行调了多次）：只取首个，忽略其余。
    const first = join(taskRoot, 'root', 'first', 'task.md')
    const second = join(taskRoot, 'root', 'second', 'task.md')
    const nestInputs: string[] = []
    let runs = 0
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      if (runs === 1) {
        const context = request.options.toolsContext.agent_schedule_task as {
          scheduleTask: (path: string) => void
        }
        context.scheduleTask(first)
        context.scheduleTask(second)
        return undefined
      }
      if (request.message) nestInputs.push(request.message.parts.at(-1)!.text)
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ sessionId: 'session', message, cwd: 'cwd' }, sink)

    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledOnce())
    // 只下探首个任务：nest 输入只含 first，不含 second。
    expect(nestInputs).toHaveLength(1)
    expect(nestInputs[0]).toContain(first)
    expect(nestInputs[0]).not.toContain(second)
    expect(runs).toBe(2)
  })

  it('stops the recursion after cancellation', async () => {
    // cancel() 中止当前 worker；编排层据跨轮信号不再继续下一轮递归。
    const child = join(taskRoot, 'root', 'child', 'task.md')
    let runs = 0
    let release: (() => void) | undefined
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      if (runs === 1) {
        const context = request.options.toolsContext.agent_schedule_task as {
          scheduleTask: (path: string) => void
        }
        context.scheduleTask(child)
        return undefined
      }
      // 第二轮（子任务）挂起，直到测试显式取消。
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ sessionId: 'session', message, cwd: 'cwd' }, sink)
    await vi.waitFor(() => expect(runs).toBe(2))
    agent.cancel('session')
    release?.()

    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledOnce())
    // 取消后不再回主链续跑（runs 停在第 2 轮）。
    await new Promise((r) => setTimeout(r, 30))
    expect(runs).toBe(2)
  })

  it('ends the stream when cancelled between rounds (while refreshing plugins)', async () => {
    // 回归：在**两轮之间**取消（编排层正 await refreshPlugins）时，cancel() 拿到的 worker
    // 已跑完本轮、其 controller 已清空，worker.cancel() 不通知 sink；若编排层在 signal.aborted
    // 处只 return 不 end，主进程就永远不发 agent:end，调用方会卡在"运行中"。
    const child = join(taskRoot, 'root', 'child', 'task.md')
    let runs = 0
    let refreshCount = 0
    let releaseRefresh: (() => void) | undefined
    mocks.refreshPlugins.mockImplementation(async () => {
      refreshCount++
      // 第 2 次 refresh 发生在第 1 轮调度子任务、准备第 2 轮之间：挂起以便精确插入取消。
      if (refreshCount === 2) {
        await new Promise<void>((resolve) => {
          releaseRefresh = resolve
        })
      }
    })
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      const context = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (path: string) => void
      }
      if (runs === 1) context.scheduleTask(child)
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ sessionId: 'session', message, cwd: 'cwd' }, sink)
    await vi.waitFor(() => expect(refreshCount).toBe(2))
    agent.cancel('session')
    releaseRefresh?.()

    // 取消后必须恰好结束一次（且不进入子任务轮）。
    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledOnce())
    expect(sink.error).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 30))
    expect(sink.end).toHaveBeenCalledOnce()
    expect(runs).toBe(1)
  })

  it('passes the first turn through unchanged', async () => {
    let firstInput: UIMessage | undefined
    mocks.run.mockImplementationOnce(async (_s, request) => {
      firstInput = request.message
      return undefined
    })
    const continuation: UIMessage = {
      id: 'continuation',
      role: 'assistant',
      parts: [{ type: 'text', text: 'the answer' }]
    }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(
      { sessionId: 'session', message: continuation, cwd: 'cwd' },
      {
        chunk: vi.fn(),
        error: vi.fn(),
        end: vi.fn()
      }
    )

    await vi.waitFor(() => expect(firstInput).toBeDefined())
    expect(firstInput).toBe(continuation)
    expect(
      (firstInput!.metadata as { originalText?: string } | undefined)?.originalText
    ).toBeUndefined()
  })

  it('reports an error when the refresh between scheduled rounds fails', async () => {
    const error = new Error('refresh failed')
    mocks.refreshPlugins
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw error
      })
    mocks.run.mockImplementationOnce(async (_s, request) => {
      const context = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (path: string) => void
      }
      context.scheduleTask(join(taskRoot, 'root'))
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ sessionId: 'session', message, cwd: 'cwd' }, sink)

    await vi.waitFor(() => expect(sink.error).toHaveBeenCalledWith(error))
    expect(sink.end).toHaveBeenCalledOnce()
  })

  it('accumulates processing time across scheduled rounds', async () => {
    const bases: number[] = []
    let runs = 0
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      bases.push((request as { baseProcessingMs?: number }).baseProcessingMs ?? 0)
      const context = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (path: string) => void
      }
      if (runs === 1) context.scheduleTask(join(taskRoot, 'root', 'child', 'task.md'))
      return {
        id: `assistant-${runs}`,
        role: 'assistant',
        metadata: { totalProcessingMs: runs * 1000 }
      } as UIMessage
    })
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send(
      { sessionId: 'session', message, cwd: 'cwd' },
      {
        chunk: vi.fn(),
        error: vi.fn(),
        end: vi.fn()
      }
    )

    // run1 主任务调度子任务 → run2 子任务（不再调度）→ 结束：2 轮。
    await vi.waitFor(() => expect(runs).toBe(2))
    expect(bases[0]).toBe(0)
    expect(bases[1]).toBe(1000)
  })

  it('does not end the stream while a task is scheduled', async () => {
    let ended = false
    let runs = 0
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      const context = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (path: string) => void
      }
      if (runs === 1) context.scheduleTask(join(taskRoot, 'root', 'child', 'task.md'))
      return undefined
    })
    const sink = {
      chunk: vi.fn(),
      error: vi.fn(),
      end: vi.fn(() => {
        ended = true
      })
    }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ sessionId: 'session', message, cwd: 'cwd' }, sink)

    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledOnce())
    expect(runs).toBe(2)
    expect(ended).toBe(true)
  })

  it('stops instead of looping when the same top-level task is scheduled repeatedly', async () => {
    // 回归：模型"回父"后再原地调度同一顶层任务，不能无限循环（实测曾跑满 50+ 轮）。
    let runs = 0
    const top = join(taskRoot, 'root', 'task.md')
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      const context = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (path: string) => void
      }
      context.scheduleTask(top)
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ sessionId: 'session', message, cwd: 'cwd' }, sink)

    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledOnce())
    // run1 主任务调度顶层任务 → run2 主链续跑又调度顶层任务（原地打转）→ 结束：2 轮。
    expect(runs).toBe(2)
  })

  it('ends the stream once when no task is ever scheduled', async () => {
    let runs = 0
    mocks.run.mockImplementation(async () => {
      runs++
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(sessions as never, pluginHost as never)

    agent.send({ sessionId: 'session', message, cwd: 'cwd' }, sink)

    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledOnce())
    // 单轮：无调度 → 结束。
    expect(runs).toBe(1)
  })
})
