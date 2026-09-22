/**
 * 决定性探针 2：复现截图那一刻（会话 ecdd751e）的 live state。
 *
 * 现场证据（真实库）：
 *   #6780 user
 *   #6781 assistant 342 parts / **17 个 show_progress** / schedule → ui-activity-history-duplicate/task.md
 *   #6782 user(nested,compaction) = nest 判据
 *   #6783 assistant 103 parts / 4 个 sp（nested 行）
 *   #6784 user(nested,compaction)
 *   #6785 assistant 43 parts / 1 个 sp（nested 行）
 *   #6786 user（用户新发的「看看当前最新的这个会话…」）  ← 截图时刻就在这之后
 *   #6787 assistant 195 parts / 22 个 sp（**含后 16 个 = 本任务的新步骤**） / schedule
 *   #6788 user(nested,compaction)
 *   #6789 assistant 76 parts / 13 sp（nested 行）
 *
 * 截图（用户报「每一项都有两个」）对应的时刻：主链轮 #6787 正在流式推进、
 * 其 16 个新阶段已出现一遍，**同时第 6781 行的 17 个阶段已从 DB 载入并可见**。
 * 本探针让真实 `Chat` 从 DB 载入 [..., #6781 ...]、再重放 #6787 的流，
 * 统计「16 个标题各出现几次」以及 assistant id 是否重复 / 是否有超集副本。
 */
import type { UIMessage, UIMessageChunk, ChatTransport } from 'ai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const home = mkdtempSync(join(tmpdir(), 'larify-live16-'))
process.env.LARIFY_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), runtime: vi.fn(), refreshPlugins: vi.fn() }))
vi.mock('../../../../src/main/core/agent/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/core/agent/engine')>()
  return { ...actual, runAgent: mocks.runAgent }
})
vi.mock('../../../../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.runtime }))

import { streamText, simulateReadableStream, type ToolSet } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { Agent } from '../../../../src/main/core/agent/agent'
import { SessionStore } from '../../../../src/main/core/session/store'
import { Chat } from '@ai-sdk/react'

const stores: SessionStore[] = []
function createStore(): SessionStore {
  const store = new SessionStore(join(home, `s-${Math.random().toString(36).slice(2)}.db`))
  stores.push(store)
  return store
}
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
})

const LOG: string[] = []
const log = (s: string): void => void LOG.push(s)

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
const sp = (id: string, title: string) => tc(id, 'agent_show_progress', { title, toolCallTitle: title })
const txt = (id: string, d: string) => [
  { type: 'text-start', id },
  { type: 'text-delta', id, delta: d },
  { type: 'text-end', id }
]
const stages = (prefix: string, titles: string[]): unknown[] => {
  const out: unknown[] = []
  titles.forEach((t, i) => {
    out.push(...txt(`${prefix}_t${i}`, `内容${i}`))
    out.push(sp(`${prefix}_s${i}`, t))
  })
  return out
}

const SID = 'ecdd751e-d661-4991-9616-6781832dee0d'
const CHILD = 'C:/Users/hylnb/.larify/tasks/ui-activity-history-duplicate/task.md'

function loadRealRows(): UIMessage[] {
  const db = new DatabaseSync(process.env.APPDATA + '/larify/sessions.db', { readOnly: true })
  const rows = db.prepare('SELECT value FROM messages WHERE session_id = ? ORDER BY position').all(SID)
  return rows.map((r) => JSON.parse(r.value))
}

function stageTitles(m: UIMessage): string[] {
  return m.parts
    .filter((p) => p.type === 'tool-agent_show_progress')
    .map((p) => (p as { input?: { title?: string } }).input?.title ?? '')
}
/** 数 DOM 折叠头等价物：把「活动历史卡」的每个 section 标题计数（近似 message-list 的聚合口径）。 */
function countSections(rows: UIMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const m of rows) {
    if (m.role !== 'assistant') continue
    for (const t of stageTitles(m)) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return counts
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
      agent_schedule_task: { sessionId: SID, cwd: home },
      agent_reset_context: { sessionId: SID, cwd: home },
      agent_ask_user: { sessionId: SID, cwd: home },
      agent_show_progress: { sessionId: SID, cwd: home }
    }
  })
})

const STEPS_16 = [
  '调研最新会话 UI 重复 item（每项两个）',
  '固化进度与知识，交由 handoff 续跑',
  '定位 UI 重复 item 的现场与会话数据',
  '读取运行实例 live state（CDP）判定重复来源',
  '核对 persist 锚点逻辑与渲染层兜底（是否回归）',
  '读渲染层聚合实现，判定重复来源',
  '追渲染层消息组装链路（loadMessages / 流式合并）',
  '找运行实例日志与 main 进程 stream id 证据',
  '加「预载 DB 消息 + 流式续跑」场景复现重复',
  'jsdom 渲染真实组件 + 真实 DB 消息（复现刷新后的样子）',
  '审查 boundaryActivityHistory 的重复渲染路径',
  'jsdom 复现：真实 DB 行 vs 注入超集副本',
  '精确统计：截图时刻的消息集下各标题出现次数',
  '追 initialMessages 来源与 Chat 重建条件',
  '查 main 进程如何启用远程调试（以便读 live state）',
  '探针：末条是 compaction user 时嵌套轮流是否 push 副本'
]

describe('决定探针2：截图时刻的 live state（#6781 载入 + #6787 流式）', () => {
  it('★ 真实 Chat 载入 DB 前 7 行 → 重放 #6787 的流（含那 16 个阶段）', async () => {
    const real = loadRealRows()
    log('\n=== 真实库会话 ecdd751e 全链 ===')
    for (let i = 0; i < real.length; i += 1) {
      const m = real[i]
      const meta = (m.metadata ?? {}) as Record<string, unknown>
      log(
        `  [${i}] ${m.role} id=${m.id.slice(0, 34)} parts=${m.parts.length} nested=${meta.nested ?? ''} sp=${stageTitles(m).length}`
      )
    }

    // 截图时刻：DB 已含 #6780..#6786（7 行），其中 #6781 有 17 个 stage
    const upTo7 = real.slice(0, 7)
    const baseCounts = countSections(upTo7)
    log('\n  载入前 7 行后，16 个标题的出现次数：')
    for (const t of STEPS_16) log(`    ${baseCounts.get(t) ?? 0}  ← ${t}`)

    // 重建 #6787 的流（用真实库里该行的真实 stage 标题；文本用占位，签名一致）
    const real6787 = real[6]
    const titles6787 = stageTitles(real6787)
    const script6787: unknown[] = [
      { type: 'stream-start', warnings: [] },
      ...stages('s6787', titles6787),
      tc('c_sched_6787', 'agent_schedule_task', { taskPath: CHILD }),
      finish
    ]

    const store = createStore()
    store.createSession({ id: SID, title: 't', cwd: home })
    store.saveMessages(SID, upTo7)

    mocks.runAgent.mockImplementation((_m: unknown, options: { tools: ToolSet; stopWhen: unknown }) => {
      const model = new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({ chunks: script6787 as never[], chunkDelayInMs: 0 })
        })
      })
      return streamText({
        model,
        messages: [{ role: 'user', content: 'x' }],
        tools: options.tools,
        stopWhen: options.stopWhen as never
      }).stream
    })

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    const transport: ChatTransport<UIMessage> = {
      async sendMessages({ messages }) {
        const last = messages.at(-1)
        const buf: UIMessageChunk[] = []
        await new Promise<void>((resolve) => {
          void agent.send(
            {
              sessionId: SID,
              cwd: home,
              message: last ?? ({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'x' }] } as UIMessage)
            },
            { chunk: (c) => buf.push(c), title: () => {}, error: () => resolve(), end: () => resolve() }
          )
        })
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            for (const c of buf) controller.enqueue(c)
            controller.close()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }

    // 渲染层以 DB 前 7 行为初值（= 用户看到的、#6781 的 17 个阶段）
    const chat = new Chat<UIMessage>({ id: SID, messages: upTo7, transport })
    log('\n  载入后 chat.messages = ' + JSON.stringify(chat.messages.map((m) => ({ id: m.id.slice(0, 30), role: m.role, parts: m.parts.length }))))
    log('  发送方送出的 message（last）= ' + JSON.stringify(real[6]?.id))

    // 用户此刻发出的新消息 = #6786（截图时的提问）
    const newUser = real[6]
    await chat.sendMessage({ text: '看看当前最新的这个会话，为什么ui上会出现重复的item? 每一项看上去都有两个' + ' ' + newUser.id })

    log('\n  流式结束后 chat.messages = ' + JSON.stringify(chat.messages.map((m) => ({ id: m.id.slice(0, 34), role: m.role, parts: m.parts.length }))))
    const afterCounts = countSections(chat.messages)
    log('\n  ★ 16 个标题的出现次数（live state）：')
    let doubled = 0
    for (const t of STEPS_16) {
      const c = afterCounts.get(t) ?? 0
      if (c > 1) doubled += 1
      log(`    ${c}  ← ${t}`)
    }
    log(`  ⇒ 出现次数 > 1 的标题数 = ${doubled} / 16`)

    const assistants = chat.messages.filter((m) => m.role === 'assistant')
    const ids = assistants.map((m) => m.id)
    log(`  assistant 条数=${ids.length} 唯一=${new Set(ids).size} 重复=${ids.length - new Set(ids).size}`)
    for (let i = 0; i < assistants.length; i += 1) {
      for (let j = 0; j < assistants.length; j += 1) {
        if (i === j) continue
        const a = assistants[i].parts
        const b = assistants[j].parts
        if (a.length < b.length && JSON.stringify(b.slice(0, a.length)) === JSON.stringify(a)) {
          log(`  ⚠️ 超集副本：[${i}](${assistants[i].id.slice(0, 26)},${a.length}p) ⊂ [${j}](${assistants[j].id.slice(0, 26)},${b.length}p)`)
        }
      }
    }
    log('\n  live vs DB 一致性：DB 行数=' + store.loadVisibleMessages(SID, 0, 100).length + '，live 条数=' + chat.messages.length)
    expect(true).toBe(true)
  }, 90000)
})

afterAll(() => {
  console.log('\n\n========== live16 探针输出 ==========')
  for (const line of LOG) console.log(line)
})
