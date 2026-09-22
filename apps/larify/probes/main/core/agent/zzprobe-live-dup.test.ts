/**
 * 探针（只读诊断）：复现「UI 上一模一样的内容出现两遍」——用**真实渲染层 `Chat`**
 * （`@ai-sdk/react`，真实合并逻辑）+ 真实主进程 persist/worker/agent + 打桩模型，
 * 把主进程产出的 `UIMessageChunk` 流经真实 `ChatTransport` 喂给 `Chat`，
 * 再读 live `chat.messages` 的 assistant id 是否重复。
 *
 * ⚠️ 关键：**不手抄合并逻辑**（既有教训：手抄会把理解替换被测物）。这里让
 * `@ai-sdk/react` 的 `AbstractChat.makeRequest` 真正执行 replace/push 判定，
 * 因此它检验的正是「主进程给的流 id 与 chat 末条 id 是否一致」这一契约。
 */
import type { UIMessage, UIMessageChunk, ChatTransport } from 'ai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const home = mkdtempSync(join(tmpdir(), 'larify-livedup-'))
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
import type { AgentSink } from '../../../../src/main/core/agent/worker'
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

function sink(): AgentSink {
  return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
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

/** 用真实 Chat + 自定义 transport：transport 每次请求时「重新跑主进程一轮」，把 chunk 流返回。 */
async function runScenario(
  scripts: unknown[][],
  turns: number,
  preloadFromDb = false
): Promise<{ chat: Chat<UIMessage>; store: SessionStore; startIds: string[][] }> {
  const { store } = createStore()
  store.createSession({ id: 'session', title: 't', cwd: home })

  let scriptIdx = 0
  mocks.runAgent.mockImplementation((_m: unknown, options: { tools: ToolSet; stopWhen: unknown }) => {
    const script = scripts[Math.min(scriptIdx, scripts.length - 1)]
    scriptIdx += 1
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

  const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
  const startIds: string[][] = []

  // 真实 Chat；transport 在每次 sendMessages 时驱动主进程跑「一轮链」并回放 chunk。
  const transport: ChatTransport<UIMessage> = {
    async sendMessages({ messages, abortSignal }) {
      const last = messages.at(-1)
      const s = sink()
      const collected: UIMessageChunk[] = []
      ;(s.chunk as unknown as ReturnType<typeof vi.fn>).mockImplementation((c: UIMessageChunk) => {
        collected.push(c)
      })
      await new Promise<void>((resolve) => {
        const wrapped: AgentSink = {
          chunk: (c) => collected.push(c),
          title: () => {},
          error: () => resolve(),
          end: () => resolve()
        }
        void agent.send(
          {
            sessionId: 'session',
            cwd: home,
            message: last ?? ({ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'go' }] } as UIMessage)
          },
          wrapped
        )
        void abortSignal
      })
      startIds.push(collected.filter((c) => c.type === 'start').map((c) => String((c as { messageId?: string }).messageId)))
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const c of collected) controller.enqueue(c)
          controller.close()
        }
      })
    },
    async reconnectToStream() {
      return null
    }
  }

  const chat = new Chat<UIMessage>({ id: 'session', messages: [], transport })
  for (let i = 0; i < turns; i += 1) {
    await chat.sendMessage({ text: `round${i}` })
  }
  return { chat, store, startIds }
}

describe('探针：live-state 是否出现重复的 assistant（UI 每一项两遍）', () => {
  it('★★★ 定论：多轮嵌套（main→nested→nested）且 renderer 预载 DB 主链行', async () => {
    // 最贴近现场 ecdd751e：renderer 从 DB 载入「主链行」（assistant）后，
    // 主进程继续在同一 agent 链里跑 nested → nested。检验每轮 start id 是否与
    // renderer 当前末条 assistant id 一致（不一致 ⇒ push ⇒ 超集副本 ⇒ UI 重复）。
    const { store } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    // 预置：主链轮已落库（renderer 会从 DB 载入它）
    const mainId = 'MAIN'
    const mainRow: UIMessage = {
      id: mainId,
      role: 'assistant',
      metadata: { startedAt: 1, completedAt: 2 },
      parts: [
        { type: 'text', text: '主链正文' } as never,
        { type: 'tool-agent_show_progress', state: 'output-available', input: { title: '阶段1' }, toolCallId: 's1' } as never,
        { type: 'tool-agent_show_progress', state: 'output-available', input: { title: '阶段2' }, toolCallId: 's2' } as never,
        { type: 'tool-agent_schedule_task', state: 'output-available', input: { taskPath: CHILD }, toolCallId: 'sc' } as never
      ]
    }
    const userRow: UIMessage = { id: 'U1', role: 'user', parts: [{ type: 'text', text: 'go' }] }
    store.saveMessages('session', [userRow, mainRow])

    // 主进程：轮0 = 继续主链（不调度则结束）→ 这里直接跑「嵌套轮×2」，模拟已在链中
    let idx = 0
    const scripts: unknown[][] = [
      [{ type: 'stream-start', warnings: [] }, ...stages('n1', ['子A', '子B']), tc('c_s1', 'agent_schedule_task', { taskPath: CHILD }), finish],
      [{ type: 'stream-start', warnings: [] }, ...stages('n2', ['孙A']), finishStop]
    ]
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

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    const startIds: string[][] = []
    const transport: ChatTransport<UIMessage> = {
      async sendMessages({ messages }) {
        const last = messages.at(-1)
        const buf: UIMessageChunk[] = []
        await new Promise<void>((resolve) => {
          void agent.send(
            { sessionId: 'session', cwd: home, message: last ?? userRow },
            { chunk: (c) => buf.push(c), title: () => {}, error: () => resolve(), end: () => resolve() }
          )
        })
        startIds.push(buf.filter((c) => c.type === 'start').map((c) => String((c as { messageId?: string }).messageId)))
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

    // renderer 从 DB 载入 [user, main]
    const chat = new Chat<UIMessage>({ id: 'session', messages: [userRow, mainRow], transport })
    await chat.sendMessage({ text: 'go' })

    log('\n=== ★★★ 定论：main(预载) → nested → nested ===')
    log('  start messageId 序列 = ' + JSON.stringify(startIds))
    log('  预载主链 id = ' + mainId)
    const assistants = chat.messages.filter((m) => m.role === 'assistant')
    log('  live assistant: ' + JSON.stringify(assistants.map((m) => ({ id: m.id.slice(0, 40), parts: m.parts.length }))))
    const ids = assistants.map((m) => m.id)
    log(`  assistant 条数=${ids.length} 唯一=${new Set(ids).size} 重复=${ids.length - new Set(ids).size}`)
    for (let i = 0; i < assistants.length; i += 1)
      for (let j = 0; j < assistants.length; j += 1) {
        if (i === j) continue
        const a = JSON.stringify(assistants[i].parts)
        const b = JSON.stringify(assistants[j].parts)
        if (a.length < b.length && b.startsWith(a.slice(0, -1))) {
          log(`  ⚠️ [${i}](parts=${assistants[i].parts.length}) 是 [${j}](parts=${assistants[j].parts.length}) 的前缀 ⇒ 超集副本 ⇒ UI 重复`)
        }
      }
    log('  DB 行: ' + JSON.stringify(store.loadVisibleMessages('session', 0, 100).map((m) => ({ id: m.id.slice(0, 40), role: m.role, nested: (m.metadata as Record<string, unknown> | undefined)?.nested, parts: m.parts.length }))))
    expect(true).toBe(true)
  }, 30000)

  it('★★ 决定性：真实嵌套轮 —— renderer 已持主链行，nested 流 start id 是否复用主链 id', async () => {
    // 真正复现现场：主链轮先跑完（含 schedule），**同一 agent.send 内**进入嵌套轮。
    // renderer 的 chat 在收到「主链轮 chunk」后，应把 nested 轮的流**并进同一 assistant**
    // （replaceLastMessage），而非 push。
    const { store } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    let idx = 0
    const scripts3: unknown[][] = [
      // 轮0 主链：3 阶段 + schedule
      [{ type: 'stream-start', warnings: [] }, ...stages('m', ['阶段1', '阶段2', '阶段3']), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish],
      // 轮1 嵌套：1 阶段
      [{ type: 'stream-start', warnings: [] }, ...stages('n1', ['子A']), finishStop]
    ]
    mocks.runAgent.mockImplementation((_m: unknown, options: { tools: ToolSet; stopWhen: unknown }) => {
      const script = scripts3[Math.min(idx, scripts3.length - 1)]
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

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    const startIds: string[][] = []
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
        startIds.push(buf.filter((c) => c.type === 'start').map((c) => String((c as { messageId?: string }).messageId)))
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

    // renderer 空白起步（新会话），先发一条
    const chat = new Chat<UIMessage>({ id: 'session', messages: [], transport })
    await chat.sendMessage({ text: 'go' })

    log('\n=== ★★ 决定性：真实嵌套轮 ===')
    log('  start messageId 序列（按 send）= ' + JSON.stringify(startIds))
    const assistants = chat.messages.filter((m) => m.role === 'assistant')
    log('  live assistant: ' + JSON.stringify(assistants.map((m) => ({ id: m.id.slice(0, 30), parts: m.parts.length }))))
    const ids = assistants.map((m) => m.id)
    log(`  assistant 条数=${ids.length} 唯一=${new Set(ids).size} 重复=${ids.length - new Set(ids).size}`)
    // 超集副本检测
    for (let i = 0; i < assistants.length; i += 1) {
      for (let j = 0; j < assistants.length; j += 1) {
        if (i === j) continue
        const a = JSON.stringify(assistants[i].parts)
        const b = JSON.stringify(assistants[j].parts)
        if (a.length < b.length && b.startsWith(a.slice(0, -1))) {
          log(`  ⚠️ [${i}](parts=${assistants[i].parts.length}) 是 [${j}](parts=${assistants[j].parts.length}) 的前缀 ⇒ 超集副本`)
        }
      }
    }
    log('  DB 行: ' + JSON.stringify(store.loadVisibleMessages('session', 0, 100).map((m) => ({ id: m.id.slice(0, 30), role: m.role, nested: (m.metadata as Record<string, unknown> | undefined)?.nested, parts: m.parts.length }))))
    expect(true).toBe(true)
  }, 30000)

  it('★ 关键：chat.messages 末条是 compaction user 时，嵌套轮是否 push 出副本', async () => {
    // 现场 ecdd751e：主链轮(16) 落库后，**nest 判据 user（compaction）也落库**；
    // 渲染层若在「主链轮已结束、判据 user 已成末条」的状态下收到嵌套轮的流，
    // `replaceLastMessage = state.message.id === lastMessage.id` 可能因末条是 user 而失败
    // ⇒ pushMessage 新建一条以主链行为基线的副本 ⇒ UI 整段重复。
    const { store } = createStore()
    store.createSession({ id: 'session', title: 't', cwd: home })

    // 手工构造「主链轮已落库 + 判据 user 已落库」的初始状态（= 渲染层从 DB 加载到的样子）
    const mainRow: UIMessage = {
      id: 'MAIN',
      role: 'assistant',
      parts: [
        { type: 'text', text: '主链正文' } as never,
        { type: 'tool-agent_show_progress', state: 'output-available', input: { title: '阶段1' } } as never,
        { type: 'tool-agent_schedule_task', state: 'output-available', input: { taskPath: CHILD } } as never
      ]
    }
    const compactionUser: UIMessage = {
      id: 'NEST-PROMPT',
      role: 'user',
      metadata: { nested: true, compaction: true },
      parts: [{ type: 'text', text: 'nest prompt' }]
    }
    store.saveMessages('session', [mainRow, compactionUser])

    // 现在跑嵌套轮的**主进程**（真实 persist/worker），让它产出 chunk
    let scriptIdx = 0
    const scripts2: unknown[][] = [
      [{ type: 'stream-start', warnings: [] }, ...stages('n1', ['子A']), txt('n1x', '子任务正文'), finishStop]
    ]
    mocks.runAgent.mockImplementation((_m: unknown, options: { tools: ToolSet; stopWhen: unknown }) => {
      const script = scripts2[Math.min(scriptIdx, scripts2.length - 1)]
      scriptIdx += 1
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

    const agent = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    const collected: UIMessageChunk[] = []
    const s = sink()
    ;(s.chunk as unknown as ReturnType<typeof vi.fn>).mockImplementation((c: UIMessageChunk) => collected.push(c))

    // 关键：模拟渲染层此刻 chat.messages = [mainRow, compactionUser]（末条是 user）
    // 用真实 Chat 承载这些消息，再用真实 transport 喂 chunk。
    const chat = new Chat<UIMessage>({ id: 'session', messages: [mainRow, compactionUser] })
    log('\n=== 关键场景：chat 末条 = compaction user ===')
    log('  初始 chat.messages: ' + JSON.stringify(chat.messages.map((m) => ({ id: m.id, role: m.role }))))

    // 直接触发 chat 的流处理（等同 transport.sendMessages 返回该流）
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const c of collected) controller.enqueue(c)
        controller.close()
      }
    })
    // 先跑主进程（填充 collected）——注意 agent.send 会立即执行，故先收集再建流
    // 这里用一个「惰性流」：在 pull 时才跑 agent（保证 collected 已填充）。
    // 简化：先 await agent.send（收集 chunk），再用 chat 的私有 API 处理。
    // 由于 Chat 不暴露 push chunk 的公开 API，这里用 `chat.sendMessage` + transport 重来。
    void stream

    // 用真实 sendMessage + transport 的方式（推荐）：
    const transportStartIds: string[][] = []
    const agent2 = new Agent(store as never, { refreshPlugins: mocks.refreshPlugins } as never)
    let scriptIdx2 = 0
    mocks.runAgent.mockImplementation((_m: unknown, options: { tools: ToolSet; stopWhen: unknown }) => {
      const script = scripts2[Math.min(scriptIdx2, scripts2.length - 1)]
      scriptIdx2 += 1
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
    const transport: ChatTransport<UIMessage> = {
      async sendMessages({ messages }) {
        const last = messages.at(-1)
        const buf: UIMessageChunk[] = []
        await new Promise<void>((resolve) => {
          void agent2.send(
            { sessionId: 'session', cwd: home, message: last ?? compactionUser },
            {
              chunk: (c) => buf.push(c),
              title: () => {},
              error: () => resolve(),
              end: () => resolve()
            }
          )
        })
        transportStartIds.push(buf.filter((c) => c.type === 'start').map((c) => String((c as { messageId?: string }).messageId)))
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
    const chat2 = new Chat<UIMessage>({ id: 'session', messages: [mainRow, compactionUser], transport })
    // 记录主进程内部的 UI 身份决策
    const lastVisible = store.lastVisibleAssistant('session')
    log('  [主进程] lastVisibleAssistant = ' + JSON.stringify({ id: lastVisible?.id, role: lastVisible?.role, nested: (lastVisible?.metadata as Record<string, unknown> | undefined)?.nested }))
    log('  [主进程] loadMessages = ' + JSON.stringify(store.loadMessages('session').map((m) => ({ id: m.id, role: m.role }))))
    await chat2.sendMessage({ text: 'x' })
    log('  （注意：本 send 的 message 末条是 user ⇒ 主链轮，非嵌套轮）')
    log('  嵌套轮流 start.messageId = ' + JSON.stringify(transportStartIds))
    log('  结束后 chat.messages = ' + JSON.stringify(chat2.messages.map((m) => ({ id: m.id.slice(0, 30), role: m.role, parts: m.parts.length }))))
    const assistants = chat2.messages.filter((m) => m.role === 'assistant')
    const ids = assistants.map((m) => m.id)
    const dup = ids.length - new Set(ids).size
    log(`  assistant 条数=${ids.length} 唯一=${new Set(ids).size} 重复=${dup}`)
    // 有无「超集副本」：某 assistant 的 parts 是否以另一条为前缀
    for (let i = 0; i < assistants.length; i += 1) {
      for (let j = 0; j < assistants.length; j += 1) {
        if (i === j) continue
        const a = JSON.stringify(assistants[i].parts)
        const b = JSON.stringify(assistants[j].parts)
        if (a.length < b.length && b.startsWith(a.slice(0, -1))) {
          log(`  ⚠️ [${i}] 是 [${j}] 的前缀（超集副本）：a=${assistants[i].parts.length} b=${assistants[j].parts.length}`)
        }
      }
    }
    expect(true).toBe(true)
  }, 30000)

  it('主链轮(3阶段) → 嵌套轮(1阶段)：live assistant id 不重复', async () => {
    const scripts = [
      [{ type: 'stream-start', warnings: [] }, ...stages('m', ['阶段1', '阶段2', '阶段3']), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish],
      [{ type: 'stream-start', warnings: [] }, ...stages('n1', ['子阶段A']), finishStop]
    ]
    const { chat, startIds } = await runScenario(scripts, 1)
    log('\n=== 场景1：主链(3阶段)→嵌套(1阶段) ===')
    log('start messageId 序列: ' + JSON.stringify(startIds))
    const assistants = chat.messages.filter((m) => m.role === 'assistant')
    log('live assistant: ' + JSON.stringify(assistants.map((m) => ({ id: m.id.slice(0, 40), parts: m.parts.length }))))
    const ids = assistants.map((m) => m.id)
    log('重复 id 数 = ' + (ids.length - new Set(ids).size))
    expect(ids.length - new Set(ids).size).toBe(0)
  }, 30000)

  it('主链轮(16阶段) → 嵌套轮(3) → 嵌套轮(1)：模拟 ecdd751e', async () => {
    const scripts = [
      [{ type: 'stream-start', warnings: [] }, ...stages('m', Array.from({ length: 16 }, (_, i) => `阶段${i + 1}`)), tc('c_s', 'agent_schedule_task', { taskPath: CHILD }), finish],
      [{ type: 'stream-start', warnings: [] }, ...stages('n1', ['子A', '子B', '子C']), tc('c_s2', 'agent_schedule_task', { taskPath: CHILD }), finish],
      [{ type: 'stream-start', warnings: [] }, ...stages('n2', ['孙A']), finishStop]
    ]
    const { chat, startIds } = await runScenario(scripts, 1)
    log('\n=== 场景2：主链(16)→嵌套(3)→嵌套(1) ===')
    log('start messageId 序列: ' + JSON.stringify(startIds))
    const assistants = chat.messages.filter((m) => m.role === 'assistant')
    log('live assistant: ' + JSON.stringify(assistants.map((m) => ({ id: m.id.slice(0, 44), parts: m.parts.length }))))
    const ids = assistants.map((m) => m.id)
    log('重复 id 数 = ' + (ids.length - new Set(ids).size))
    // 检查「超集副本」：后一条是否以前一条为前缀
    for (let i = 1; i < assistants.length; i += 1) {
      const a = JSON.stringify(assistants[i - 1].parts)
      const b = JSON.stringify(assistants[i].parts)
      log(`  [${i - 1}]→[${i}] b 以 a 为前缀? ${b.startsWith(a.slice(0, Math.min(a.length, 50)))} (a.parts=${assistants[i - 1].parts.length}, b.parts=${assistants[i].parts.length})`)
    }
    expect(ids.length - new Set(ids).size).toBe(0)
  }, 30000)
})

afterAll(() => {
  console.log('\n\n========== live-dup 探针输出 ==========')
  for (const line of LOG) console.log(line)
})
