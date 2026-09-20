import type { UIMessage } from 'ai'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'ask-user-cont-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

// 只 mock 模型层，保留真实的 persist / store / orchestrator，以复现端到端行为。
const mocks = vi.hoisted(() => ({ run: vi.fn(), runtime: vi.fn() }))
vi.mock('../../../../src/main/core/agent/session', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/main/core/agent/session')>(
    '../../../../src/main/core/agent/session'
  )
  return { ...actual, runAgentSession: mocks.run }
})
vi.mock('../../../../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.runtime }))
vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyPath: (...segments: string[]) => '~/.larify/' + segments.join('/'),
  larifyWorkspacePath: () => workspace
}))
vi.mock('../../../../src/main/core/git/snapshot', () => ({
  GitSnapshotService: class {
    start = vi.fn(async () => null)
    compare = vi.fn(async () => null)
  }
}))

import { Agent } from '../../../../src/main/core/agent/agent'
import { SessionStore } from '../../../../src/main/core/session'

interface Call {
  count: number
  chars: number
}

function makeAgent(store: SessionStore) {
  return new Agent(store as never, {
    refreshPlugins: vi.fn(async () => undefined)
  } as never)
}

function sink() {
  return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
}

/** AI SDK 合并语义：流内消息 parts = anchor.parts + 本轮增量 */
function merged(anchorParts: UIMessage['parts'], incremental: UIMessage['parts']): UIMessage['parts'] {
  return [...anchorParts, ...incremental]
}

const MAIN_PARTS: UIMessage['parts'] = [
  { type: 'step-start' },
  { type: 'text', text: 'X'.repeat(120000) }, // 巨型主链
  {
    type: 'tool-agent_schedule_task',
    toolCallId: 'sched-1',
    state: 'output-available',
    input: {},
    output: 'scheduled'
  } as never
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runtime.mockReturnValue({
    system: 'runtime',
    toolsContext: {
      agent_ask_user: { sessionId: 'session' },
      agent_schedule_task: { sessionId: 'session' }
    }
  })
})

describe('ask_user 续写的上下文归属', () => {
  it('【核心】子任务轮 ask_user 后，其后续写入 user 行 → 回答续写仍应只送本轮（不得越权送整条主链）', async () => {
    const dbPath = join(workspace, 'sessions.db')
    rmSync(dbPath, { force: true })
    const store = new SessionStore(dbPath)
    const calls: Call[] = []

    let round = 0
    mocks.run.mockImplementation(
      async (messages: UIMessage[], options: { toolsContext?: Record<string, unknown> }) => {
        round += 1
        calls.push({ count: messages.length, chars: JSON.stringify(messages).length })
        const scheduler = (options.toolsContext?.agent_schedule_task as
          | { scheduleTask?: (p: string) => void }
          | undefined) ?? {}

        // 轮1（主链）：巨型 assistant + 调度子任务
        if (round === 1) {
          scheduler.scheduleTask?.('C:/tasks/sub/task.md')
          return [
            ...messages,
            { id: 'main-anchor', role: 'assistant', parts: [...MAIN_PARTS] } as UIMessage
          ]
        }
        // 轮2（子任务）：以 ask_user(input-available) 结尾（合并到 anchor 之后）
        if (round === 2) {
          return [
            ...messages,
            {
              id: 'main-anchor',
              role: 'assistant',
              parts: merged(MAIN_PARTS, [
                { type: 'step-start' },
                { type: 'text', text: '子任务：请定方向' },
                {
                  type: 'tool-agent_ask_user',
                  toolCallId: 'ask-nested-1',
                  state: 'input-available',
                  input: { message: '请选择方向' }
                } as never
              ])
            } as UIMessage
          ]
        }
        return [...messages, { id: 'a' + round, role: 'assistant', parts: [{ type: 'text', text: 'ok' }] } as UIMessage]
      }
    )

    const agent = makeAgent(store)

    // —— 阶段 1：用户提问（主链轮 → 子任务轮 → 停在子任务轮的 ask_user）——
    await agent.send(
      { sessionId: 'session', cwd: workspace, message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始' }] } },
      sink()
    )
    await new Promise((r) => setTimeout(r, 50))

    // 找到承载 ask_user 的那条消息（嵌套行，带 nested=true + 可见 ask_user）
    const owner = store
      .loadVisibleMessages('session')
      .find((m) =>
        (m.parts as Array<{ type: string; toolCallId?: string }>).some(
          (p) => p.type === 'tool-agent_ask_user' && p.toolCallId === 'ask-nested-1'
        )
      ) as UIMessage | undefined
    expect(owner, '库里应有承载 ask-nested-1 的消息').toBeDefined()
    expect((owner!.metadata as { nested?: boolean } | undefined)?.nested, '承载者是嵌套行').toBe(true)

    // ★ 制造失效条件：在 ask_user 那条之后再写入一条「nest 判据」(role=user)，
    //   使其成为 lastMessage —— 这正是真实会话中「调度/回父」会发生的写入。
    store.saveMessages('session', [
      {
        id: 'later-nest-prompt',
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [{ type: 'text', text: 'To complete the parent task.md' }]
      } as UIMessage
    ])
    const last = store.lastMessage('session') as UIMessage
    expect(last.role, 'lastMessage 现在是 user 判据').toBe('user')

    // —— 阶段 2：模拟渲染层提交回答（把该 ask_user part 置 output-available）——
    const answer: UIMessage = {
      ...(owner as UIMessage),
      parts: (owner as UIMessage).parts.map((p) =>
        (p as { type: string; toolCallId?: string }).type === 'tool-agent_ask_user' &&
        (p as { toolCallId?: string }).toolCallId === 'ask-nested-1'
          ? ({ ...p, state: 'output-available', output: '选 A' } as never)
          : p
      )
    }
    const before = calls.length
    await agent.send({ sessionId: 'session', cwd: workspace, message: answer }, sink())
    await new Promise((r) => setTimeout(r, 50))

    const continuation = calls[before]
    expect(continuation, '回答续写应调用模型').toBeDefined()
    // ★ 断言：本应是子任务轮续写 ⇒ 只送 1 条；修复前会越权送整条主链（记录 2 条 / 12 万+ 字符）
    expect(continuation.count).toBe(1)
    expect(continuation.chars).toBeLessThan(1000)
    store.dispose()
  })

  it('普通用户提问（不含已答 ask_user）→ 送整条主链（行为不变）', async () => {
    const dbPath = join(workspace, 'sessions-plain.db')
    rmSync(dbPath, { force: true })
    const store = new SessionStore(dbPath)
    const calls: Call[] = []
    mocks.run.mockImplementation(async (messages: UIMessage[]) => {
      calls.push({ count: messages.length, chars: JSON.stringify(messages).length })
      return [...messages, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] } as UIMessage]
    })
    const agent = makeAgent(store)
    await agent.send(
      { sessionId: 'session', cwd: workspace, message: { id: 'u', role: 'user', parts: [{ type: 'text', text: '你好' }] } },
      sink()
    )
    await new Promise((r) => setTimeout(r, 50))
    // 首次提问永远是主链轮：送整条主链（此处只有 1 条 user）
    expect(calls[0].count).toBe(1)
    store.dispose()
  })

  it('toolCallId 在库中找不到 → 回退到 lastMessage 判据，不抛错', async () => {
    const dbPath = join(workspace, 'sessions-fallback.db')
    rmSync(dbPath, { force: true })
    const store = new SessionStore(dbPath)
    let called = false
    mocks.run.mockImplementation(async (messages: UIMessage[]) => {
      called = true
      return [...messages, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] } as UIMessage]
    })
    const agent = makeAgent(store)
    // 直接送一条「含已答 ask_user、但库里查不到该 toolCallId」的 assistant 消息
    const orphan: UIMessage = {
      id: 'orphan',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'x' },
        { type: 'tool-agent_ask_user', toolCallId: 'nope', state: 'output-available', output: 'ok' } as never
      ]
    }
    await agent.send({ sessionId: 'session', cwd: workspace, message: orphan }, sink())
    await new Promise((r) => setTimeout(r, 50))
    expect(called, '回退路径仍应调用模型（不抛错、不静默丢弃）').toBe(true)
    store.dispose()
  })
})
