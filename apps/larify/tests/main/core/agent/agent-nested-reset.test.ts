import type { UIMessage } from 'ai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const home = mkdtempSync(join(tmpdir(), 'larify-nested-reset-'))
process.env.LARIFY_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ run: vi.fn(), runtime: vi.fn(), refreshPlugins: vi.fn() }))
// 保留真实 persist 模块（markNested 等），仅替换其网络执行入口，让 saveStart/nested 标记
// 等真实持久化逻辑参与测试。
vi.mock('../../../../src/main/core/agent/persist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/core/agent/persist')>()
  return { ...actual, runStoredAgentSession: mocks.run }
})
vi.mock('../../../../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.runtime }))

import { Agent } from '../../../../src/main/core/agent/agent'
import { SessionStore } from '../../../../src/main/core/session/store'

const taskRoot = join(home, '.larify', 'tasks')
const stores: SessionStore[] = []

function createStore(): SessionStore {
  const store = new SessionStore(join(home, `s-${Math.random().toString(36).slice(2)}.db`))
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runtime.mockReturnValue({
    system: 'runtime',
    toolsContext: {
      agent_schedule_task: { sessionId: 'session', cwd: 'cwd' },
      agent_reset_context: { sessionId: 'session', cwd: 'cwd' }
    }
  })
})

/**
 * 回归：嵌套子任务的 reset 续写不得移动主链游标 `sessions.start`。
 * 若移动，主链上下文会被截断——`loadMessages` 只剩子任务之后的残片。
 * 断言方式：直接检查 store（不再依赖「回主链轮」—— 该轮已移除：没调度即结束整条链）。
 */
describe('Agent nested reset keeps the main chain intact', () => {
  it('preserves the main-chain context after a child round resets its context', async () => {
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    store.saveMessages('session', [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'original question' }] } as UIMessage,
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'original answer' }]
      } as UIMessage
    ])

    const child = join(taskRoot, 'root', 'child', 'task.md')
    let runs = 0
    const schedule = (request: unknown): ((p: string) => void) =>
      (request as { options: { toolsContext: Record<string, Record<string, unknown>> } }).options
        .toolsContext.agent_schedule_task.scheduleTask as (p: string) => void
    const reset = (request: unknown): ((v: string) => void) =>
      (request as { options: { toolsContext: Record<string, Record<string, unknown>> } }).options
        .toolsContext.agent_reset_context.requestContextReset as (v: string) => void

    // 每次 run 的「第几轮编排」不固定：nested 轮的 reset 会在**同一个 worker 内部**
    // 触发一次 handoff 续写（`while(handoff)`），故 mock 调用次数多于编排轮次数。
    // 这里不硬编码次数，只关心：run1 主链调度 → nested 轮 reset（+其 handoff 续写回父）
    // → 最终回到主链时主链上下文是否完整。
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      // run1 主任务调度子任务。
      if (runs === 1) {
        schedule(request)(child)
        return undefined
      }
      // nested 轮：首次进入触发 reset（handoff 续写由 worker 内部再调一次 run）。
      if (runs === 2) {
        reset(request)('Continue child.')
        return undefined
      }
      // nested 的 handoff 续写：回父（调度顶层任务）。
      if (runs === 3) {
        schedule(request)(join(taskRoot, 'root', 'task.md'))
        return undefined
      }
      return undefined
    })

    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(store, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        message: { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'go' }] } as UIMessage,
        cwd: 'cwd'
      },
      sink
    )

    await vi.waitFor(() => expect(sink.end).toHaveBeenCalled(), { timeout: 3000 })
    // 主链历史必须完整（nested 的 reset 未移动 sessions.start 游标 → 未被截断）。
    expect(store.loadMessages('session').map((m) => m.id)).toEqual(['u1', 'a1'])
  })
})
