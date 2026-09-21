/**
 * reset_context 之后，模型新问的 ask_user 与用户的回答**都进不了模型输入**。
 *
 * 根因（源码级）：`persist.ts` 在 reset 续写轮（`isCompaction`）把上一条主链 assistant（`#MAIN`）
 * 并入 `originalMessages` 末条，AI SDK 因此**复用 MAIN 的 id**
 * （源码 `handleUIMessageStreamFinish`：「末条是 assistant ⇒ messageId = lastMessage.id」）。
 * 而 MAIN 已被 `saveStart` 甩到 `sessions.start` **之前** ⇒ 本轮产出的新 ask_user 也写回 MAIN
 * ⇒ `loadMessages()`（只读 `position >= start`）永远读不到 ⇒ 模型每轮都像第一次一样重问、
 * 用户的回答永远进不了模型。
 *
 * 本测试只打桩**模型层**（`engine.runAgent` 换成真实 `streamText` + `MockLanguageModelV4`），
 * 让 agent / persist / session / store 全走真实代码，从而真正覆盖「落库 id 的决策」。
 *
 * 不变量（修复后必须成立）：
 *   I1 `start` 之后存在一条 assistant 行，承载着 **未答** 的 ask_user
 *   I2 回答之后，模型输入里含该 ask_user 的 tool-call
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'reset-drop-'))
afterAll(() => {
  try {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    /* Windows 下 DB 句柄可能仍占用；测试临时目录无需清理 */
  }
})

const mocks = vi.hoisted(() => ({ modelScripts: [] as string[], createRuntime: vi.fn() }))

// 只打桩模型层：让 persist/session/store 走真实实现。
vi.mock('../../../../src/main/core/agent/engine', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/main/core/agent/engine')>(
    '../../../../src/main/core/agent/engine'
  )
  const { streamText, simulateReadableStream } = await import('ai')
  const { MockLanguageModelV4 } = await import('ai/test')

  let cursor = 0
  return {
    ...actual,
    runAgent: (messages: Parameters<typeof actual.runAgent>[0], options: Parameters<typeof actual.runAgent>[1]) => {
      // 依据「模型实际看到的输入」决定本轮产出（模拟真实模型行为）。
      const dump = JSON.stringify(messages)
      const ask2Seen = dump.includes('"call_ask2"')
      const resetSeen = dump.includes('"call_reset"')
      // 轮次判定改用「调用序号」而非「输入内容」——因为缺陷恰恰是 reset 续写轮看不到历史，
      // 用内容判定会与「缺陷本身」混淆（会让桩误以为又回到第一轮）。
      const turn = cursor + 1
      const ask1Turn = turn === 1
      const resetTurn = turn === 2

      const emit = (chunks: unknown[]) => {
        const model = new MockLanguageModelV4({
          doStream: async () => ({ stream: simulateReadableStream({ chunks: chunks as never[], chunkDelayInMs: 0 }) })
        })
        return streamText({
          model,
          messages: [{ role: 'user', content: 'x' }],
          tools: options.tools as never,
          abortSignal: options.abortSignal
        }).stream
      }

      cursor += 1
      mocks.modelScripts.push(
        `#${turn} ask2SeenInInput=${ask2Seen} resetSeenInInput=${resetSeen}`
      )

      // 轮1：用户提问 → 问 ask#1
      if (ask1Turn) {
        return emit([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'need info' },
          { type: 'text-end', id: 't1' },
          { type: 'tool-call', toolCallId: 'call_ask1', toolName: 'agent_ask_user', input: JSON.stringify({ message: 'Q1' }) },
          { type: 'finish', finishReason: 'tool-calls', usage: usage() }
        ])
      }
      // 轮2：回答 #1 送达 → 请求 reset（本轮流内触发 worker 的 while(handoff)）
      if (resetTurn) {
        ;(options.toolsContext as { agent_reset_context?: { requestContextReset?: (v: string) => void } })
          ?.agent_reset_context?.requestContextReset?.('# Handoff\n\n已完成：定位根因')
        return emit([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't2' },
          { type: 'text-delta', id: 't2', delta: '根因已定位，重置上下文' },
          { type: 'text-end', id: 't2' },
          { type: 'tool-call', toolCallId: 'call_reset', toolName: 'agent_reset_context', input: JSON.stringify({ handoff: 'H' }) },
          { type: 'finish', finishReason: 'tool-calls', usage: usage() }
        ])
      }
      // 轮3：reset 的进程内续写轮 → 问 ask#2
      if (turn === 3) {
        return emit([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't3' },
          { type: 'text-delta', id: 't3', delta: '（接续）根因结论…' },
          { type: 'text-end', id: 't3' },
          { type: 'tool-call', toolCallId: 'call_ask2', toolName: 'agent_ask_user', input: JSON.stringify({ message: 'Q2' }) },
          { type: 'finish', finishReason: 'tool-calls', usage: usage() }
        ])
      }
      // 轮4+：回答 #2 送达 → 收尾
      return emit([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't4' },
        { type: 'text-delta', id: 't4', delta: '收到回答，结束' },
        { type: 'text-end', id: 't4' },
        { type: 'finish', finishReason: 'stop', usage: usage() }
      ])
    }
  }
})

const usage = () => ({
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
  totalTokens: 2
})

vi.mock('../../../../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.createRuntime }))
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

const ASK1 = 'call_ask1'
const ASK2 = 'call_ask2'

function sink(): AgentSink {
  return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
}
function newStore(name: string): SessionStore {
  const path = join(workspace, `${name}.db`)
  const store = new SessionStore(path)
  store.createSession({ cwd: workspace, id: 'session', title: 'T' })
  return store
}
const askPart = (id: string, state: 'input-available' | 'output-available', answers?: string[]) =>
  ({
    type: 'tool-agent_ask_user',
    toolCallId: id,
    state,
    input: { message: `Q-${id}` },
    ...(state === 'output-available' ? { output: { answers } } : {})
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.modelScripts.length = 0
  mocks.createRuntime.mockReturnValue({
    system: 'runtime',
    tools: {
      agent_ask_user: { description: 'a' },
      agent_reset_context: { description: 'b' }
    },
    activeTools: ['agent_ask_user', 'agent_reset_context'],
    toolsContext: {
      agent_ask_user: { sessionId: 'session' },
      agent_reset_context: { sessionId: 'session' }
    }
  })
})

describe('reset_context 之后的 ask_user 续写落点', () => {
  it('I1+I2：reset 后的新提问必须落在 start 之内，回答能被模型看到', async () => {
    const store = newStore('reset')
    const agent = new Agent(store as never, { refreshPlugins: vi.fn(async () => undefined) } as never)

    // 轮1：用户提问 → 模型问 ask#1
    await agent.send(
      {
        sessionId: 'session',
        cwd: workspace,
        message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '问题 A' }] }
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 120))

    // 轮2：回答 #1（渲染层送来的主链 assistant 快照）
    const mainRow = store.lastMessage('session') as UIMessage
    expect(mainRow, '轮1 应已落库 assistant').toBeDefined()
    await agent.send(
      {
        sessionId: 'session',
        cwd: workspace,
        message: {
          ...mainRow,
          parts: mainRow.parts.map((p) =>
            (p as { toolCallId?: string }).toolCallId === ASK1
              ? askPart(ASK1, 'output-available', ['A1'])
              : p
          )
        }
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 200))

    console.log('\n模型调用脚本：', JSON.stringify(mocks.modelScripts))

    // ── I1：start 之内必须有一条承载「未答 ask#2」的 assistant 行 ──
    const start = store.startPosition('session')
    const ctx = store.findAskUserContext('session', ASK2)
    expect(start, 'reset 应已建立 start').toBeGreaterThan(0)
    expect(
      ctx,
      'I1 失败：reset 之后的新提问未被任何 start 之内的行承载 ⇒ 回答无处可写、模型永远看不到'
    ).toBeDefined()

    // ── I2：回答 #2 之后，模型输入必须含 ask#2 的 tool-call ──
    const before = mocks.modelScripts.length
    const answer2: UIMessage = {
      ...ctx!.owner,
      parts: ctx!.owner.parts.map((p) =>
        (p as { toolCallId?: string }).toolCallId === ASK2
          ? askPart(ASK2, 'output-available', ['A2'])
          : p
      )
    }
    await agent.send({ sessionId: 'session', cwd: workspace, message: answer2 }, sink())
    await new Promise((r) => setTimeout(r, 200))

    const afterScripts = mocks.modelScripts.slice(before)
    console.log('回答后模型脚本：', JSON.stringify(afterScripts))
    expect(afterScripts.length, 'I2 失败：回答后未触发模型调用').toBeGreaterThan(0)
    expect(
      afterScripts.some((s) => s.includes('ask2SeenInInput=true')),
      'I2 失败：模型输入里没有 ask#2 的 tool-call（模型看不到自己问过什么 ⇒ 必然重问）'
    ).toBe(true)

    store.dispose()
  }, 20000)
})
