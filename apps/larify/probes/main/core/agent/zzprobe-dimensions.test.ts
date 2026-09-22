/**
 * 探针（只读诊断，非回归）：逐一实测 ask_user / reset_context / schedule_task 之后的
 * **上下文三性** —— 隔离 / 主链 / 续写。
 *
 * 与既有探针的区别：本探针**不改产品代码**，只用真实 persist/worker/store + 打桩模型，
 * 把「模型每轮实际收到的输入」和「落库行身份」打印出来，与「应有的形态」对照。
 *
 * 输出直接 stdout（不 assert 业务正确性，只 assert 探针自身可跑），便于人工判读。
 */
import type { UIMessage } from 'ai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const home = mkdtempSync(join(tmpdir(), 'larify-dims-'))
process.env.LARIFY_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), runtime: vi.fn(), refreshPlugins: vi.fn() }))

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

const LOG: string[] = []
const log = (s: string): void => {
  LOG.push(s)
}

/** 每轮记录「模型实际收到的 messages」。 */
let observedInputs: Array<{ n: number; roles: string[]; nested: number; chars: number; kinds: string[] }> = []

function scriptedRunAgent(
  script: Array<(ctx: Record<string, Record<string, unknown>>) => unknown[]>
): void {
  let turn = 0
  mocks.runAgent.mockImplementation(
    (messages: unknown, options: { tools: ToolSet; stopWhen: unknown; abortSignal?: AbortSignal }) => {
      // 记录本轮模型输入（真实 messages）
      const msgs = messages as Array<{ role: string; parts?: Array<{ type?: string }>; metadata?: Record<string, unknown> }>
      observedInputs.push({
        n: turn,
        roles: msgs.map((m) => m.role),
        nested: msgs.filter((m) => m.metadata?.nested === true).length,
        chars: JSON.stringify(msgs).length,
        kinds: msgs.map((m) =>
          m.metadata?.compaction === true ? 'compaction' : m.metadata?.nested === true ? 'nested' : m.role
        )
      })
      log(`\n  [turn#${turn}] 输入明细：`)
      msgs.forEach((m, i) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>
        const pv = (m.parts ?? [])
          .map((p) => {
            const t = (p as { type?: string }).type ?? '?'
            if (t === 'text') return `text(${((p as { text?: string }).text ?? '').slice(0, 50)})`
            if (t.startsWith('tool-')) return t.replace('tool-agent_', '').replace('tool-', '')
            return t
          })
          .join(',')
        log(
          `    [${i}] role=${m.role} nested=${meta.nested ?? '-'} comp=${meta.compaction ?? '-'} ` +
            `parts=${m.parts?.length ?? 0} :: ${pv.slice(0, 400)}`
        )
      })
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
const finishStop = { type: 'finish', finishReason: 'stop', usage }
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

function allRows(dbPath: string): UIMessage[] {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = db
    .prepare('select position, value from messages where session_id=? order by position')
    .all('session') as unknown as Array<{ position: number; value: string }>
  db.close()
  return rows.map((r) => ({ ...(JSON.parse(r.value) as UIMessage), __pos: r.position }) as never)
}

function dumpRows(dbPath: string, label: string): void {
  log(`\n### ${label} — 落库行`)
  const rows = allRows(dbPath)
  for (const r of rows) {
    const pos = (r as never as { __pos: number }).__pos
    const meta = (r.metadata ?? {}) as Record<string, unknown>
    const n = (r.id.match(/-nested-/g) ?? []).length
    log(
      `  pos=${pos} role=${r.role} nested=${meta.nested ?? '-'} comp=${meta.compaction ?? '-'} ` +
        `parts=${r.parts?.length ?? 0} nestedSuffix=${n} id=${r.id.slice(0, 56)}`
    )
  }
}

/** 模型输入快照：nested 越权（主链轮读到 nested）/ 主链泄漏（nested 轮读到主链）。 */
function dumpInputs(label: string): void {
  log(`\n### ${label} — 模型输入（每轮）`)
  for (const o of observedInputs) {
    log(`  turn#${o.n}: msgs=${o.roles.length} nestedMsgs=${o.nested} chars=${o.chars}`)
    log(`     kinds=${JSON.stringify(o.kinds)}`)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  observedInputs = []
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

describe('探针：三工具后的上下文三性', () => {
  it('A. reset_context（主链轮）后的续写：id 基准 / 主链泄漏', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_reset_context.requestContextReset as (h: string) => void)('交接A')
        return [{ type: 'stream-start', warnings: [] }, ...bulk('m', 3), tc('c_r', 'agent_reset_context', { handoff: '交接A' }), finish]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...txt('t2', '结束'), finishStop]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '提问A' }] } as UIMessage
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 800))
    dumpRows(dbPath, 'A 主链 reset')
    dumpInputs('A 主链 reset')
    // 关键不变量：主链行（nested≠true）不得带 -nested- 后缀
    const bad = allRows(dbPath).filter(
      (r) =>
        r.role === 'assistant' &&
        (r.metadata as Record<string, unknown> | undefined)?.nested !== true &&
        r.id.includes('-nested-')
    )
    log(`\n  >>> M1 畸形行（主链行带 nested 后缀）= ${bad.length}`)
    expect(true).toBe(true)
  }, 20000)

  it('B. schedule_task → 子任务轮 → 回父：隔离性', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [{ type: 'stream-start', warnings: [] }, ...bulk('m', 3), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...bulk('n', 4), txt('tn', '子任务完成'), finishStop]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始B' }] } as UIMessage
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 800))
    dumpRows(dbPath, 'B 调度/子任务')
    dumpInputs('B 调度/子任务')
    expect(true).toBe(true)
  }, 20000)

  it('C. ask_user 回答续写 + 之后 reset：续写归属', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      () => [{ type: 'stream-start', warnings: [] }, ...bulk('a', 3), tc('c_ask', 'agent_ask_user', { message: 'Q?' }), finish]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始C' }] } as UIMessage
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 600))

    // 回答：渲染层送整条 assistant 快照
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
      () => [{ type: 'stream-start', warnings: [] }, ...txt('tb', '收到回答，继续'), finishStop]
    ])
    agent.send({ sessionId: 'session', cwd: home, message: answer }, sink())
    await new Promise((r) => setTimeout(r, 800))
    dumpRows(dbPath, 'C ask_user 续写')
    dumpInputs('C ask_user 续写')
    expect(true).toBe(true)
  }, 20000)

  it('D. 嵌套轮内 ask_user 停住 + 回答：子任务轮续写隔离', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [{ type: 'stream-start', warnings: [] }, ...bulk('m', 3), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...bulk('n', 3), tc('c_ask2', 'agent_ask_user', { message: '子任务问题' }), finish]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始D' }] } as UIMessage
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 800))

    const owner = store.lastMessage('session')!
    log(`\n  [D] owner role=${owner.role} nested=${(owner.metadata as Record<string, unknown> | undefined)?.nested} id=${owner.id.slice(0, 50)}`)
    const answer: UIMessage = {
      ...owner,
      parts: owner.parts.map((p) =>
        (p as { toolCallId?: string }).toolCallId === 'c_ask2'
          ? ({ ...p, state: 'output-available', output: { answers: ['子任务答'] } } as never)
          : p
      )
    }
    scriptedRunAgent([
      () => [{ type: 'stream-start', warnings: [] }, ...txt('td', '子任务继续'), finishStop]
    ])
    agent.send({ sessionId: 'session', cwd: home, message: answer }, sink())
    await new Promise((r) => setTimeout(r, 800))
    dumpRows(dbPath, 'D 子任务轮 ask_user 续写')
    dumpInputs('D 子任务轮 ask_user 续写')
    expect(true).toBe(true)
  }, 20000)

  it('E. 交错：reset(主链) → schedule → 子任务轮 reset → 回父：id 基准互撞', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_reset_context.requestContextReset as (h: string) => void)('交接E1')
        return [{ type: 'stream-start', warnings: [] }, ...bulk('m', 3), tc('c_r', 'agent_reset_context', { handoff: '交接E1' }), finish]
      },
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [{ type: 'stream-start', warnings: [] }, ...bulk('m2', 3), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish]
      },
      (ctx) => {
        ;(ctx.agent_reset_context.requestContextReset as (h: string) => void)('交接E3')
        return [{ type: 'stream-start', warnings: [] }, ...bulk('n', 4), tc('c_r2', 'agent_reset_context', { handoff: '交接E3' }), finish]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...txt('te', '结束'), finishStop]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始E' }] } as UIMessage
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 1000))
    dumpRows(dbPath, 'E 交错')
    dumpInputs('E 交错')
    const rows = allRows(dbPath)
    log('\n  >>> id 后缀层数分布：' + JSON.stringify(
      rows.map((r) => ({ pos: (r as never as { __pos: number }).__pos, role: r.role, nested: (r.metadata as Record<string, unknown> | undefined)?.nested, sfx: (r.id.match(/-nested-/g) ?? []).length }))
    ))
    expect(true).toBe(true)
  }, 20000)

  it('F. 嵌套轮内 reset 续写 + 该轮再调度：复现畸形行', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      // 轮0：主链调度
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [{ type: 'stream-start', warnings: [] }, ...bulk('m', 2), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish]
      },
      // 轮1：嵌套轮，内含 reset
      (ctx) => {
        ;(ctx.agent_reset_context.requestContextReset as (h: string) => void)('交接F1')
        return [{ type: 'stream-start', warnings: [] }, ...bulk('n', 2), tc('c_r', 'agent_reset_context', { handoff: '交接F1' }), finish]
      },
      // 轮2：嵌套 reset 续写轮，**又调度**（触发再一轮嵌套）
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [{ type: 'stream-start', warnings: [] }, ...bulk('n2', 2), tc('c_s2', 'agent_schedule_task', { taskPath: CHILD }), finish]
      },
      // 轮3：再嵌套
      () => [{ type: 'stream-start', warnings: [] }, ...bulk('n3', 2), txt('tn3', '完'), finishStop]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始F' }] } as UIMessage
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 1200))
    dumpRows(dbPath, 'F 嵌套reset续写再调度')
    dumpInputs('F 嵌套reset续写再调度')
    const bad = allRows(dbPath).filter(
      (r) =>
        r.role === 'assistant' &&
        (r.metadata as Record<string, unknown> | undefined)?.nested !== true &&
        r.id.includes('-nested-')
    )
    log(`\n  >>> M1 畸形行 = ${bad.length}`)
    expect(true).toBe(true)
  }, 20000)

  it('H. 关键定论：主链轮（nested=false）在「上一行是嵌套行」时的 uiOriginalMessages', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    // 轮0 主链调度 → 轮1 嵌套（结束后不调度 ⇒ 链结束）
    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [{ type: 'stream-start', warnings: [] }, ...bulk('m', 2), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...bulk('n', 3), txt('tn', '子任务完'), finishStop]
    ])
    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      { sessionId: 'session', cwd: home, message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'A' }] } as UIMessage },
      sink()
    )
    await new Promise((r) => setTimeout(r, 800))
    const lastRow = store.lastVisibleAssistant('session')!
    const lastMain = store.lastAssistant('session', 'after')
    log(`\n  [H] 会话末行 lastVisibleAssistant: id=${lastRow.id.slice(0, 50)} nested=${(lastRow.metadata as Record<string, unknown> | undefined)?.nested}`)
    log(`  [H] lastAssistant('after'): id=${lastMain?.id.slice(0, 50)} nested=${(lastMain?.metadata as Record<string, unknown> | undefined)?.nested}`)

    // 轮2：用户再发（主链轮）—— 断言产出行的 id/nested
    scriptedRunAgent([
      () => [{ type: 'stream-start', warnings: [] }, ...bulk('p', 2), txt('tp', '主链完'), finishStop]
    ])
    agent.send(
      { sessionId: 'session', cwd: home, message: { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'B' }] } as UIMessage },
      sink()
    )
    await new Promise((r) => setTimeout(r, 800))
    dumpRows(dbPath, 'H 用户再发（主链轮）')
    const bad = allRows(dbPath).filter(
      (r) =>
        r.role === 'assistant' &&
        (r.metadata as Record<string, unknown> | undefined)?.nested !== true &&
        r.id.includes('-nested-')
    )
    log(`\n  >>> M1 畸形行 = ${bad.length}（HEAD 结构上应为 0：非 nested 轮 nestedAnchor 恒 undefined）`)
    expect(bad.length).toBe(0)
  }, 20000)

  it('G. 嵌套轮 reset 后「回父」(主链轮) 紧跟：id 基准互撞', async () => {
    const { store, dbPath } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [{ type: 'stream-start', warnings: [] }, ...bulk('m', 2), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish]
      },
      (ctx) => {
        ;(ctx.agent_reset_context.requestContextReset as (h: string) => void)('交接G1')
        return [{ type: 'stream-start', warnings: [] }, ...bulk('n', 2), tc('c_r', 'agent_reset_context', { handoff: '交接G1' }), finish]
      },
      // 嵌套 reset 续写轮：**不调度** ⇒ 整条链结束 ⇒ 用户再发（主链轮）
      () => [{ type: 'stream-start', warnings: [] }, ...txt('tn', '子任务完'), finishStop]
    ])

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始G' }] } as UIMessage
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 1000))
    dumpRows(dbPath, 'G 嵌套reset后续')

    // 用户再发（主链轮）—— 此时会话末条是嵌套行
    scriptedRunAgent([
      (ctx) => {
        ;(ctx.agent_schedule_task.scheduleTask as (p: string) => void)(CHILD)
        return [{ type: 'stream-start', warnings: [] }, ...bulk('u', 2), tc('c_s2', 'agent_schedule_task', { taskPath: CHILD }), finish]
      },
      () => [{ type: 'stream-start', warnings: [] }, ...bulk('v', 2), txt('tv', '完'), finishStop]
    ])
    agent.send(
      {
        sessionId: 'session',
        cwd: home,
        message: { id: 'u2', role: 'user', parts: [{ type: 'text', text: '第二个问题' }] } as UIMessage
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 1200))
    dumpRows(dbPath, 'G 第二轮')
    const bad = allRows(dbPath).filter(
      (r) =>
        r.role === 'assistant' &&
        (r.metadata as Record<string, unknown> | undefined)?.nested !== true &&
        r.id.includes('-nested-')
    )
    log(`\n  >>> M1 畸形行 = ${bad.length}`)
    expect(true).toBe(true)
  }, 25000)
})

// 打印全部日志（vitest 默认会吞 stdout，这里显式打到 console）
afterAll(() => {
  console.log('\n\n========== 探针输出 ==========')
  for (const line of LOG) console.log(line)
})
