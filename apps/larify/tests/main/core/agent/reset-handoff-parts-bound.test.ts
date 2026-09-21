/**
 * 回归：reset_context 的 handoff 行 = **本轮的用户输入 + 交接摘要**（parts=2），
 * 且**绝不**把「续写轮的整条 assistant 快照」抄进来（嵌合行）。
 *
 * 不变量：
 *   1. handoff 行的 parts 里**绝不含** assistant 的 `step-start` / `tool-*` part
 *      （= 整条 assistant 快照未被复刻；这正是会话 8b152a1c 的嵌合行
 *      `#6702/#6704/#6706/#6708`（419/461 parts）的成因）；
 *   2. 末段恒为 `# Handoff\n\n<摘要>`（摘要本身自足）；
 *   3. 若本轮输入是 user（用户提问 / nest 判据），则**保留**它（parts=2，与真实库
 *      15 条历史正常判据行一致）；若是 assistant（ask_user 回答续写轮），则**不带入**
 *      （parts=1，避免「role=user 却载 assistant 正文」）。
 *
 * ⚠️ 本测试保持 persist/worker/store **真实**（只 mock 模型执行入口 engine.runAgent），
 * 以便真正走到 worker.ts 里构造 handoff 行的那段代码。
 */
import type { UIMessage } from 'ai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const home = mkdtempSync(join(tmpdir(), 'larify-handoff-bound-'))
process.env.LARIFY_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), runtime: vi.fn(), refreshPlugins: vi.fn() }))

// 只替换「模型执行入口」，其余（persist / worker / store）全部真实。
vi.mock('../../../../src/main/core/agent/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/core/agent/engine')>()
  return { ...actual, runAgent: mocks.runAgent }
})
vi.mock('../../../../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.runtime }))

import { DatabaseSync } from 'node:sqlite'
import { streamText, simulateReadableStream, type ToolSet } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { Agent } from '../../../../src/main/core/agent/agent'
import type { AgentSink } from '../../../../src/main/core/agent/worker'
import { SessionStore } from '../../../../src/main/core/session/store'

const stores: SessionStore[] = []
function createStore(): { store: SessionStore; dbPath: string } {
  const dbPath = join(home, `s-${Math.random().toString(36).slice(2)}.db`)
  const store = new SessionStore(dbPath)
  stores.push(store)
  return { store, dbPath }
}
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
})

/** 构造一个「按脚本产出工具调用」的模型执行入口。 */
function scriptedRunAgent(
  script: Array<(ctx: Record<string, Record<string, unknown>>) => unknown[]>
): void {
  let turn = 0
  mocks.runAgent.mockImplementation(
    (messages: unknown, options: { tools: ToolSet; stopWhen: unknown; abortSignal?: AbortSignal }) => {
      const ctx = (
        options as unknown as { toolsContext: Record<string, Record<string, unknown>> }
      ).toolsContext
      const chunks = script[Math.min(turn, script.length - 1)](ctx)
      turn++
      const model = new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({ chunks: chunks as never[], chunkDelayInMs: 0 })
        })
      })
      return streamText({
        model,
        messages: [{ role: 'user', content: 'x' }],
        tools: options.tools,
        stopWhen: options.stopWhen as never,
        abortSignal: options.abortSignal
      }).stream
    }
  )
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
  totalTokens: 15
}
const finish = { type: 'finish', finishReason: 'tool-calls', usage }
const tc = (id: string, name: string, input: unknown) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: name,
  input: JSON.stringify(input)
})
const txt = (id: string, d: string) => [
  { type: 'text-start', id },
  { type: 'text-delta', id, delta: d },
  { type: 'text-end', id }
]
/** 生成 n 个「文本 + 工具」步骤，把本轮的 parts 撑大（模拟真实长轮次）。 */
const bulk = (prefix: string, n: number): unknown[] => {
  const out: unknown[] = []
  for (let i = 0; i < n; i++) {
    out.push(...txt(`${prefix}_${i}`, `步骤${i}`))
    out.push(tc(`${prefix}_c${i}`, 'agent_show_progress', { title: `${prefix}-${i}` }))
  }
  return out
}

function sink(): AgentSink {
  return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
}

/**
 * 直接读库，取会话的**全部**落库行（含 `sessions.start` 那条）。
 * 不能只用 `loadVisibleMessages`——它按设计**排除** `session.start` 对应的 handoff 行，
 * 而那正是本测试要断言的对象。
 */
function allRows(dbPath: string): UIMessage[] {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = db
    .prepare('select value from messages where session_id=? order by position')
    .all('session') as unknown as Array<{ value: string }>
  db.close()
  return rows.map((r) => JSON.parse(r.value) as UIMessage)
}

/** 仅 reset_context 产出的 handoff 行（**末段**文本以 `# Handoff` 开头）。 */
function handoffRows(dbPath: string): UIMessage[] {
  return allRows(dbPath).filter(
    (m) =>
      (m.metadata as Record<string, unknown> | undefined)?.compaction === true &&
      ((m.parts?.at(-1) as { text?: string } | undefined)?.text ?? '').startsWith('# Handoff')
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runtime.mockReturnValue({
    system: 'runtime',
    tools: {
      agent_schedule_task: { description: 's' },
      agent_reset_context: { description: 'r' },
      agent_ask_user: { description: 'a' },
      agent_show_progress: { description: 'p' }
    },
    activeTools: ['agent_schedule_task', 'agent_reset_context', 'agent_ask_user', 'agent_show_progress'],
    toolsContext: {
      agent_schedule_task: { sessionId: 'session', cwd: home },
      agent_reset_context: { sessionId: 'session', cwd: home },
      agent_ask_user: { sessionId: 'session', cwd: home },
      agent_show_progress: { sessionId: 'session', cwd: home }
    }
  })
})

const CHILD = join(home, '.larify', 'tasks', 'root', 'child', 'task.md')

/** 公共断言：handoff 行绝不含 assistant 的 step-start / tool-* part。 */
function assertNoAssistantParts(row: UIMessage): void {
  const parts = row.parts ?? []
  expect(parts.some((p) => p.type === 'step-start')).toBe(false)
  expect(parts.some((p) => String(p.type).startsWith('tool-'))).toBe(false)
}

describe('reset_context 的 handoff 行 = 用户输入 + 摘要（且绝不含 assistant 快照）', () => {
  it('主链轮 reset：handoff 行 = [用户提问, 摘要]（parts=2）', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_reset_context.requestContextReset as (h: string) => void)('主链交接')
        return [
          { type: 'stream-start', warnings: [] },
          ...bulk('m', 3),
          tc('c_reset', 'agent_reset_context', { handoff: '主链交接' }),
          finish
        ]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...txt('t2', '结束'), { type: 'finish', finishReason: 'stop', usage }]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '我的提问' }] } as UIMessage
      },
      sink()
    )
    await vi.waitFor(() => expect(handoffRows(dbPath).length).toBeGreaterThan(0), { timeout: 3000 })
    await new Promise((r) => setTimeout(r, 200))

    const rows = handoffRows(dbPath)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      const parts = r.parts ?? []
      assertNoAssistantParts(r)
      // parts=2：本轮用户输入 + 摘要
      expect(parts.length).toBe(2)
      expect((parts[0] as { text?: string }).text).toBe('我的提问')
      expect((parts[1] as { text?: string }).text).toBe('# Handoff\n\n主链交接')
    }
  }, 20000)

  it('nested 轮 reset：handoff 行 = [nest 判据, 摘要]（parts=2）', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [
          { type: 'stream-start', warnings: [] },
          ...txt('t1', '主链调度'),
          tc('c_sched', 'agent_schedule_task', { taskPath: CHILD }),
          finish
        ]
      },
      (ctx) => {
        ;(ctx.agent_reset_context.requestContextReset as (h: string) => void)('子任务交接')
        return [
          { type: 'stream-start', warnings: [] },
          ...bulk('n', 5),
          tc('c_reset', 'agent_reset_context', { handoff: '子任务交接' }),
          finish
        ]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...txt('t3', '结束'), { type: 'finish', finishReason: 'stop', usage }]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始' }] } as UIMessage
      },
      sink()
    )
    await vi.waitFor(() => expect(handoffRows(dbPath).length).toBeGreaterThan(0), { timeout: 3000 })
    await new Promise((r) => setTimeout(r, 200))

    const rows = handoffRows(dbPath)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      const parts = r.parts ?? []
      assertNoAssistantParts(r)
      // parts=2：本轮 nest 判据（1 part） + 摘要
      expect(parts.length).toBe(2)
      expect((parts[0] as { text?: string }).text).toContain('To complete the current task')
      expect((parts[1] as { text?: string }).text).toBe('# Handoff\n\n子任务交接')
    }
  }, 20000)

  it('回答轮 reset：handoff 行**不带入** assistant 快照（parts=1，摘要）', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      () => [
        { type: 'stream-start', warnings: [] },
        ...bulk('a', 4),
        tc('c_ask', 'agent_ask_user', { message: 'Q?' }),
        finish
      ]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始' }] } as UIMessage
      },
      sink()
    )
    await vi.waitFor(
      () =>
        expect(
          allRows(dbPath).length +
            store.loadVisibleMessages('session', 0, 1000).filter((m) => m.role === 'assistant').length
        ).toBeGreaterThan(0),
      { timeout: 3000 }
    )
    await new Promise((r) => setTimeout(r, 200))

    // 回答：渲染层送「整条 assistant 快照」（含 ask_user 已答）—— 正是嵌合行的来源。
    const owner = store.lastMessage('session')!
    const answer: UIMessage = {
      ...owner,
      parts: owner.parts.map((p) =>
        (p as { toolCallId?: string }).toolCallId === 'c_ask'
          ? ({ ...p, state: 'output-available', output: { answers: ['OK'] } } as never)
          : p
      )
    }

    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_reset_context.requestContextReset as (h: string) => void)('回答后交接')
        return [
          { type: 'stream-start', warnings: [] },
          ...bulk('b', 4),
          tc('c_reset', 'agent_reset_context', { handoff: '回答后交接' }),
          finish
        ]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...txt('tb', '结束'), { type: 'finish', finishReason: 'stop', usage }]
    ])

    agent.send({ sessionId: 'session', cwd: home, message: answer }, sink())
    await new Promise((r) => setTimeout(r, 600))

    const rows = handoffRows(dbPath)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      const parts = r.parts ?? []
      // 核心断言：**绝不**出现 assistant 的 step-start / tool-* part（整条快照未被抄进来）
      assertNoAssistantParts(r)
      // assistant 输入 ⇒ 不带入（parts=1，只有摘要）
      expect(parts.length).toBe(1)
      expect((parts[0] as { text?: string }).text).toBe('# Handoff\n\n回答后交接')
    }
  }, 20000)
})
