/**
 * 决定性探针：判定 HEAD 上「UI 每一项出现两个」是否仍可复现。
 *
 * 做法（不手抄合并逻辑）：真实 `@ai-sdk/react` 的 `Chat` + 自定义 `ChatTransport`，
 * transport 每次请求驱动真实 `Agent.send`（真实 persist/worker/store），把 chunk 流回放给 Chat；
 * 逐轮读取 (a) 主进程流内 start.messageId、(b) Chat 此刻「末条 assistant id」、(c) 是否 push 出新条。
 *
 * 三个关键场景：
 *  1. renderer 预载 DB 主链行（= 刷新/切换会话后再继续），同一 send 内跑嵌套轮。
 *  2. renderer 末条是 nest 判据 user（compaction）时收到嵌套轮流。
 *  3. 真实多轮嵌套（main → nested → nested）模拟 ecdd751e。
 */
import type { UIMessage, UIMessageChunk, ChatTransport } from 'ai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const home = mkdtempSync(join(tmpdir(), 'larify-dupdecide-'))
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
const log = (s: string): void => void LOG.push(s)

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

const CHILD = join(home, '.larify', 'tasks', 'root', 'child', 'task.md')

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

function stubScripts(scripts: unknown[][]): void {
  let idx = 0
  mocks.runAgent.mockImplementation((_m: unknown, options: { tools: ToolSet; stopWhen: unknown }) => {
    const script = scripts[Math.min(idx, scripts.length - 1)]
    idx += 1
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: script as never[], chunkDelayInMs: 0 })
      })
    })
    return streamText({
      model,
      messages: [{ role: 'user', content: 'x' }],
      tools: options.tools,
      stopWhen: options.stopWhen as never
    }).stream
  })
}

/** 逐次 send 记录：主进程流内 start id、Chat 本次 send 前的末条 assistant id、send 后 assistant 数。 */
interface RoundTrace {
  startIds: string[]
  lastAssistantBeforeSend: string | undefined
  assistantsAfter: Array<{ id: string; parts: number }>
}

/**
 * 用真实 Chat 跑 `turns` 次 sendMessage；每次 transport 调用驱动真实 Agent.send。
 * @param preloaded 初始 chat.messages（模拟渲染层从 DB 载入）
 */
async function runChat(
  scripts: unknown[][],
  turns: number,
  preloaded: UIMessage[] = []
): Promise<{ chat: Chat<UIMessage>; store: SessionStore; trace: RoundTrace[] }> {
  const { store } = createStore()
  store.createSession({ id: 'session', title: 't', cwd: home })
  stubScripts(scripts)
  const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
  const trace: RoundTrace[] = []

  const transport: ChatTransport<UIMessage> = {
    async sendMessages({ messages }) {
      const last = messages.at(-1)
      const buf: UIMessageChunk[] = []
      await new Promise<void>((resolve) => {
        void agent.send(
          {
            sessionId: 'session',
            cwd: home,
            message: last ?? ({ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'go' }] } as UIMessage)
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

  const chat = new Chat<UIMessage>({ id: 'session', messages: preloaded, transport })
  for (let i = 0; i < turns; i += 1) {
    const before = chat.messages.filter((m) => m.role === 'assistant')
    const beforeLast = before.at(-1)?.id
    // 记录本轮 send 的主进程流 id：包一层 transport 拦截（重建 Chat 太重，改用 after 差值）
    const assistantsBefore = new Set(chat.messages.map((m) => m.id))
    await chat.sendMessage({ text: `round${i}` })
    const assistantsAfter = chat.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => ({ id: m.id, parts: m.parts.length }))
    const newIds = chat.messages.filter((m) => m.role === 'assistant' && !assistantsBefore.has(m.id))
    trace.push({
      startIds: newIds.map((m) => m.id),
      lastAssistantBeforeSend: beforeLast,
      assistantsAfter
    })
  }
  return { chat, store, trace }
}

/** 检测「超集副本」：a 的 parts 是 b 的严格前缀。 */
function findCopies(chat: Chat<UIMessage>): string[] {
  const assistants = chat.messages.filter((m) => m.role === 'assistant')
  const out: string[] = []
  for (let i = 0; i < assistants.length; i += 1) {
    for (let j = 0; j < assistants.length; j += 1) {
      if (i === j) continue
      const a = assistants[i].parts
      const b = assistants[j].parts
      if (
        a.length < b.length &&
        JSON.stringify(b.slice(0, a.length)) === JSON.stringify(a)
      ) {
        out.push(`[${i}](${assistants[i].id.slice(0, 24)},${a.length}p) ⊂ [${j}](${assistants[j].id.slice(0, 24)},${b.length}p)`)
      }
    }
  }
  return out
}

const MAIN_16 = stages('m', Array.from({ length: 16 }, (_, i) => `阶段${i + 1}`))
const SCRIPT_16_3_1: unknown[][] = [
  [{ type: 'stream-start', warnings: [] }, ...MAIN_16, tc('c_s1', 'agent_schedule_task', { taskPath: CHILD }), finish],
  [{ type: 'stream-start', warnings: [] }, ...stages('n1', ['子A', '子B', '子C']), tc('c_s2', 'agent_schedule_task', { taskPath: CHILD }), finish],
  [{ type: 'stream-start', warnings: [] }, ...stages('n2', ['孙A']), finishStop]
]

describe('决定性探针：HEAD 上「UI 每一项出现两个」是否仍可复现', () => {
  it('场景A：单次 send 内的 main(16)→nested(3)→nested(1)（模拟 ecdd751e）', async () => {
    const { chat, store, trace } = await runChat(SCRIPT_16_3_1, 1)
    log('\n=== 场景A：单 send 内 main(16)→nested(3)→nested(1) ===')
    log('  trace = ' + JSON.stringify(trace.map((t) => ({ before: t.lastAssistantBeforeSend?.slice(0, 20), after: t.assistantsAfter.length }))))
    log('  live assistant = ' + JSON.stringify(chat.messages.filter((m) => m.role === 'assistant').map((m) => ({ id: m.id.slice(0, 34), parts: m.parts.length }))))
    const ids = chat.messages.filter((m) => m.role === 'assistant').map((m) => m.id)
    log(`  assistant 条数=${ids.length} 唯一=${new Set(ids).size} 重复=${ids.length - new Set(ids).size}`)
    const copies = findCopies(chat)
    log('  超集副本 = ' + (copies.length ? JSON.stringify(copies) : '无'))
    log('  DB 行 = ' + JSON.stringify(store.loadVisibleMessages('session', 0, 100).map((m) => ({ id: m.id.slice(0, 30), role: m.role, nested: (m.metadata as Record<string, unknown> | undefined)?.nested, parts: m.parts.length }))))
    expect(new Set(ids).size).toBe(ids.length)
    expect(copies).toEqual([])
  }, 60000)

  it('场景B：renderer 预载 DB 主链行（刷新/切会话后再继续），单次 send 内 main(16)→nested(3)', async () => {
    const { store } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })
    // 真实链路已落库的「主链轮 + nest 判据」由场景A 产出；这里用真实 Agent 先跑一遍落库。
    const runOnce = await runChat(SCRIPT_16_3_1, 1)
    const preloaded = runOnce.store.loadVisibleMessages('session', 0, 100)
    log('\n=== 场景B：renderer 预载 DB 行（' + preloaded.length + ' 条）后再继续 ===')
    log('  预载 = ' + JSON.stringify(preloaded.map((m) => ({ id: m.id.slice(0, 30), role: m.role, nested: (m.metadata as Record<string, unknown> | undefined)?.nested, parts: m.parts.length }))))
    // 新 Chat 以 DB 行为初值（= 刷新后），再发一轮（走主链轮）
    const scripts2: unknown[][] = [
      [{ type: 'stream-start', warnings: [] }, ...stages('m2', ['新阶段']), finishStop]
    ]
    const chat2 = await runChatWithPreloaded(scripts2, 1, preloaded)
    log('  live assistant = ' + JSON.stringify(chat2.chat.messages.filter((m) => m.role === 'assistant').map((m) => ({ id: m.id.slice(0, 34), parts: m.parts.length }))))
    const ids = chat2.chat.messages.filter((m) => m.role === 'assistant').map((m) => m.id)
    log(`  assistant 条数=${ids.length} 唯一=${new Set(ids).size} 重复=${ids.length - new Set(ids).size}`)
    const copies = findCopies(chat2.chat)
    log('  超集副本 = ' + (copies.length ? JSON.stringify(copies) : '无'))
    expect(new Set(ids).size).toBe(ids.length)
  }, 60000)

  it('场景C：多轮 send（每轮都从 live state 继续）——检验跨 send 的锚点一致性', async () => {
    const { chat, store, trace } = await runChat(SCRIPT_16_3_1, 3)
    log('\n=== 场景C：3 轮 send ===')
    log('  trace = ' + JSON.stringify(trace))
    const ids = chat.messages.filter((m) => m.role === 'assistant').map((m) => m.id)
    log('  live assistant = ' + JSON.stringify(chat.messages.filter((m) => m.role === 'assistant').map((m) => ({ id: m.id.slice(0, 34), parts: m.parts.length }))))
    log(`  assistant 条数=${ids.length} 唯一=${new Set(ids).size} 重复=${ids.length - new Set(ids).size}`)
    const copies = findCopies(chat)
    log('  超集副本 = ' + (copies.length ? JSON.stringify(copies) : '无'))
    log('  DB 行 = ' + JSON.stringify(store.loadVisibleMessages('session', 0, 100).map((m) => ({ id: m.id.slice(0, 30), role: m.role, nested: (m.metadata as Record<string, unknown> | undefined)?.nested, parts: m.parts.length }))))
  }, 60000)
})

/** runChat 的变体：允许传入预载消息。 */
async function runChatWithPreloaded(
  scripts: unknown[][],
  turns: number,
  preloaded: UIMessage[]
): Promise<{ chat: Chat<UIMessage>; store: SessionStore; trace: RoundTrace[] }> {
  const { store } = createStore()
  // 用与预载一致的 DB（把预载写进新库）
  store.createSession({ id: 'session', title: 't', cwd: home })
  store.saveMessages('session', preloaded)
  stubScripts(scripts)
  const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
  const trace: RoundTrace[] = []
  const transport: ChatTransport<UIMessage> = {
    async sendMessages({ messages }) {
      const last = messages.at(-1)
      const buf: UIMessageChunk[] = []
      await new Promise<void>((resolve) => {
        void agent.send(
          { sessionId: 'session', cwd: home, message: last ?? ({ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'go' }] } as UIMessage) },
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
  const chat = new Chat<UIMessage>({ id: 'session', messages: preloaded, transport })
  for (let i = 0; i < turns; i += 1) {
    await chat.sendMessage({ text: `round${i}` })
    trace.push({
      startIds: [],
      lastAssistantBeforeSend: undefined,
      assistantsAfter: chat.messages.filter((m) => m.role === 'assistant').map((m) => ({ id: m.id, parts: m.parts.length }))
    })
  }
  return { chat, store, trace }
}

afterAll(() => {
  console.log('\n\n========== dup-decide 探针输出 ==========')
  for (const line of LOG) console.log(line)
})
