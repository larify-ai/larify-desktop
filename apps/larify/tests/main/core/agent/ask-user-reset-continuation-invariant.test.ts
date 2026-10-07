/**
 * 回归守门（不变量）：ask_user 的回答必须能进入模型输入——即使中途发生 reset_context。
 *
 * 场景（与真实会话 `f97e2d22`「四轮足运控资料」同形）：
 *   提问 → ask1 → 回答 → reset_context → ask2 → 回答 → ask3 → 回答 → ask4
 *   ★ 渲染端（真实行为）在每轮 send 时都下传它**此刻持有的末端 UI id**。
 *
 * 不变量：任一时刻，承载「最新未答 ask_user」的行必须能被 `loadMessages()`（模型输入）读到。
 *   （否则用户答完，回答落在 `start` 之前 ⇒ 模型读不到 ⇒ 反复重问同一问题。）
 *
 * 本测试只桩**模型层**，persist/session/store/agent 全走真实代码。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'ask-reset-inv-'))
afterAll(() => {
  try {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    /* Windows 下 DB 句柄可能仍占用 */
  }
})

const mocks = vi.hoisted(() => ({ scripts: [] as string[], runtime: vi.fn() }))

vi.mock('../../../../src/main/core/agent/engine', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/main/core/agent/engine')>(
    '../../../../src/main/core/agent/engine'
  )
  const { streamText, simulateReadableStream } = await import('ai')
  const { MockLanguageModelV4 } = await import('ai/test')

  let turn = 0
  return {
    ...actual,
    runAgent: (messages: unknown, options: Parameters<typeof actual.runAgent>[1]) => {
      const dump = JSON.stringify(messages)
      turn += 1
      const t = turn
      const seen = ['ask1', 'ask2', 'ask3', 'ask4'].filter((a) => dump.includes(`"${a}"`))
      mocks.scripts.push(`#${t} seen=[${seen.join(',')}]`)

      const usage = () => ({
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
        totalTokens: 2
      })
      const emit = (chunks: unknown[]) => {
        const model = new MockLanguageModelV4({
          doStream: async () => ({
            stream: simulateReadableStream({ chunks: chunks as never[], chunkDelayInMs: 0 })
          })
        })
        return streamText({
          model,
          messages: [{ role: 'user', content: 'x' }],
          tools: options.tools as never,
          abortSignal: options.abortSignal
        }).stream
      }
      const ask = (id: string) => ({
        type: 'tool-call',
        toolCallId: id,
        toolName: 'agent_ask_user',
        input: JSON.stringify({ message: `Q-${id}` })
      })
      const text = (id: string, s: string) => [
        { type: 'text-start', id },
        { type: 'text-delta', id, delta: s },
        { type: 'text-end', id }
      ]
      const reset = () =>
        (
          options.toolsContext as {
            agent_reset_context?: { requestContextReset?: (v: string) => void }
          }
        )?.agent_reset_context?.requestContextReset?.('# Handoff\n\n继续')

      // 轮1：用户提问 → 问 ask1
      if (t === 1)
        return emit([
          { type: 'stream-start', warnings: [] },
          ...text('t1', 'ask1'),
          ask('ask1'),
          { type: 'finish', finishReason: 'tool-calls', usage: usage() }
        ])
      // 轮2：回答 ask1 送达 → 模型 reset
      if (t === 2) {
        reset()
        return emit([
          { type: 'stream-start', warnings: [] },
          ...text('t2', 'reset'),
          {
            type: 'tool-call',
            toolCallId: 'call_reset',
            toolName: 'agent_reset_context',
            input: JSON.stringify({ handoff: 'H' })
          },
          { type: 'finish', finishReason: 'tool-calls', usage: usage() }
        ])
      }
      // 轮3：reset 进程内续写 → 问 ask2
      if (t === 3)
        return emit([
          { type: 'stream-start', warnings: [] },
          ...text('t3', 'cont'),
          ask('ask2'),
          { type: 'finish', finishReason: 'tool-calls', usage: usage() }
        ])
      // 轮4/5/6：回答后继续问下一个
      if (t === 4)
        return emit([
          { type: 'stream-start', warnings: [] },
          ...text('t4', 'c'),
          ask('ask3'),
          { type: 'finish', finishReason: 'tool-calls', usage: usage() }
        ])
      if (t === 5)
        return emit([
          { type: 'stream-start', warnings: [] },
          ...text('t5', 'd'),
          ask('ask4'),
          { type: 'finish', finishReason: 'tool-calls', usage: usage() }
        ])
      return emit([
        { type: 'stream-start', warnings: [] },
        ...text('t6', 'done'),
        { type: 'finish', finishReason: 'stop', usage: usage() }
      ])
    }
  }
})

vi.mock('../../../../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.runtime }))
vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyPath: (...s: string[]) => '~/.larify/' + s.join('/'),
  larifyWorkspacePath: () => workspace
}))
vi.mock('../../../../src/main/core/git/snapshot', () => ({
  GitSnapshotService: class {
    start = vi.fn(async () => null)
    compare = vi.fn(async () => null)
  }
}))

import { Agent } from '../../../../src/main/core/agent/agent'
import type { AgentSink } from '../../../../src/main/core/agent/worker'
import { SessionStore } from '../../../../src/main/core/session'

/** 模拟真实渲染端：捕获流里 `start` chunk 的 messageId，作为「渲染端此刻持有的末端 id」。 */
function sink(): { sink: AgentSink; heldId: () => string | undefined } {
  let held: string | undefined
  const s: AgentSink = {
    chunk: (c: { type?: string; messageId?: string }) => {
      if (c?.type === 'start' && c.messageId) held = c.messageId
    },
    title: vi.fn(),
    error: vi.fn(),
    end: vi.fn()
  }
  return { sink: s, heldId: () => held }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const askPart = (id: string, state: 'input-available' | 'output-available', answers?: string[]) =>
  ({
    type: 'tool-agent_ask_user',
    toolCallId: id,
    state,
    input: { message: `Q-${id}` },
    ...(state === 'output-available' ? { output: { answers } } : {})
  }) as never
const answer = (row: UIMessage, id: string): UIMessage => ({
  ...row,
  parts: row.parts.map((p) =>
    (p as { toolCallId?: string }).toolCallId === id
      ? askPart(id, 'output-available', ['A'])
      : p
  )
})
/** 不变量：承载该 ask 的行必须能被模型输入读到。 */
function readable(store: SessionStore, askId: string): boolean {
  return store
    .loadMessages('session')
    .some((m) => (m.parts ?? []).some((p) => (p as { toolCallId?: string }).toolCallId === askId))
}

function newStore(name: string): SessionStore {
  const path = join(workspace, `${name}.db`)
  rmSync(path, { force: true })
  const store = new SessionStore(path)
  store.createSession({ cwd: workspace, id: 'session', title: 'T' })
  return store
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.scripts.length = 0
  mocks.runtime.mockReturnValue({
    system: 'runtime',
    tools: { agent_ask_user: { description: 'a' }, agent_reset_context: { description: 'b' } },
    activeTools: ['agent_ask_user', 'agent_reset_context'],
    toolsContext: {
      agent_ask_user: { sessionId: 'session' },
      agent_reset_context: { sessionId: 'session' }
    }
  })
})

describe('不变量：reset 之后的 ask_user 回答必须能被模型读到', () => {
  it('四轮回答链（带真实渲染端 uiTargetId）', async () => {
    const store = newStore('inv')
    const agent = new Agent(store as never, {
      refreshPlugins: vi.fn(async () => undefined)
    } as never)

    // 轮1：提问 → ask1
    const s1 = sink()
    await agent.send(
      {
        sessionId: 'session',
        cwd: workspace,
        message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] }
      },
      s1.sink
    )
    await wait(150)
    let heldId = s1.heldId() ?? (store.lastMessage('session') as UIMessage).id

    // 轮2：回答 ask1（渲染端下传此刻持有的末端 id）
    const s2 = sink()
    await agent.send(
      {
        sessionId: 'session',
        cwd: workspace,
        uiTargetId: heldId,
        message: answer(store.lastMessage('session') as UIMessage, 'ask1')
      },
      s2.sink
    )
    await wait(300)
    // 渲染端如实折算它收到的末端 id（流 start chunk 的 messageId）
    heldId = s2.heldId() ?? heldId

    // 轮3..：逐个回答，每次都下传渲染端此刻持有的末端 id
    for (const [owner, next] of [
      ['ask2', 'ask3'],
      ['ask3', 'ask4']
    ] as const) {
      const ctx = store.findAskUserContext('session', owner)
      expect(ctx, `找不到承载 ${owner} 的行`).toBeDefined()
      expect(readable(store, owner), `不变量破裂：${owner} 的行落在 start 之前（模型读不到）`).toBe(
        true
      )
      const sc = sink()
      await agent.send(
        {
          sessionId: 'session',
          cwd: workspace,
          uiTargetId: heldId,
          message: answer(ctx!.owner, owner)
        },
        sc.sink
      )
      await wait(300)
      heldId = sc.heldId() ?? heldId
      expect(readable(store, next), `不变量破裂：${next} 的行落在 start 之前（模型读不到）`).toBe(
        true
      )
    }
    // 模型确实看到了 ask3（证明回答链接通）
    expect(mocks.scripts.some((s) => s.includes('ask3'))).toBe(true)

    // ★ 额外不变量（第五/六轮 review 的连带项）：
    // ① 「处理时长」不得在 reset 边界归零 —— 模型输入里的主链 assistant 行，
    //    其 `totalProcessingMs` 必为正有限数。
    const mainAssistants = store
      .loadMessages('session')
      .filter((m) => m.role === 'assistant')
    expect(mainAssistants.length).toBeGreaterThan(0)
    for (const m of mainAssistants) {
      const total = (m.metadata as Record<string, unknown> | undefined)?.totalProcessingMs
      expect(typeof total, `assistant ${m.id} 缺 totalProcessingMs`).toBe('number')
      expect(Number.isFinite(total as number)).toBe(true)
    }
    // ② reset 落库行不得为空 —— 每个「可见 assistant 行」至少含一个 part（防切片误切致整轮落空）。
    const visibleAssistants = store
      .loadVisibleMessages('session')
      .filter((m) => m.role === 'assistant')
    expect(visibleAssistants.length).toBeGreaterThan(0)
    for (const m of visibleAssistants) {
      expect(m.parts.length, `可见 assistant ${m.id} 为空行`).toBeGreaterThan(0)
    }

    console.log('scripts =', JSON.stringify(mocks.scripts), '最终 heldId =', heldId)
    store.dispose()
  }, 40000)
})
