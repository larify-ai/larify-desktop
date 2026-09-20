import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'ask-user-cont-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

// 只 mock 模型层；保留真实的 persist / store / orchestrator，以复现端到端行为。
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
  return new Agent(store as never, { refreshPlugins: vi.fn(async () => undefined) } as never)
}
function sink() {
  return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
}

/** AI SDK 合并语义：流内消息 parts = anchor.parts + 本轮增量 */
function merged(anchor: UIMessage['parts'], incremental: UIMessage['parts']): UIMessage['parts'] {
  return [...anchor, ...incremental]
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

function newStore(name: string): SessionStore {
  const path = join(workspace, `${name}.db`)
  rmSync(path, { force: true })
  return new SessionStore(path)
}

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

describe('ask_user 续写的上下文归属（核心回归）', () => {
  it('子任务(nested)轮 ask_user 后，其后再写入 user 行 → 回答续写仍只送本轮（不越权送整条主链）', async () => {
    const store = newStore('nested')
    const calls: Call[] = []
    let round = 0
    mocks.run.mockImplementation(
      async (messages: UIMessage[], options: { toolsContext?: Record<string, unknown> }) => {
        round += 1
        calls.push({ count: messages.length, chars: JSON.stringify(messages).length })
        const scheduler = (options.toolsContext?.agent_schedule_task as
          | { scheduleTask?: (p: string) => void }
          | undefined) ?? {}
        if (round === 1) {
          scheduler.scheduleTask?.('C:/tasks/sub/task.md')
          return [...messages, { id: 'main-anchor', role: 'assistant', parts: [...MAIN_PARTS] } as UIMessage]
        }
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
    await agent.send(
      { sessionId: 'session', cwd: workspace, message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始' }] } },
      sink()
    )
    await new Promise((r) => setTimeout(r, 50))

    // 承载者：库里那条带 ask-nested-1 且 state=input-available 的嵌套行
    const owner = store
      .loadVisibleMessages('session')
      .find((m) =>
        (m.parts as Array<{ type: string; toolCallId?: string }>).some(
          (p) => p.type === 'tool-agent_ask_user' && p.toolCallId === 'ask-nested-1'
        )
      ) as UIMessage | undefined
    expect(owner).toBeDefined()

    // ★ 制造失效条件：在 ask_user 那条之后再写入一条 nest 判据(user)，使其成为 lastMessage
    store.saveMessages('session', [
      {
        id: 'later-nest-prompt',
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [{ type: 'text', text: 'To complete the parent task.md' }]
      } as UIMessage
    ])
    expect((store.lastMessage('session') as UIMessage).role).toBe('user')

    // 用户回答：把该 ask_user 置 output-available（addToolOutput 语义）
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
    expect(continuation).toBeDefined()
    // 子任务轮续写 ⇒ 只送 1 条；修复前会越权送整条主链
    expect(continuation.count).toBe(1)
    expect(continuation.chars).toBeLessThan(1000)
    store.dispose()
  })

  it('主链轮 ask_user 续写 → 送整条主链（既有行为不变）', async () => {
    const store = newStore('main')
    const calls: Call[] = []
    let round = 0
    mocks.run.mockImplementation(async (messages: UIMessage[]) => {
      round += 1
      calls.push({ count: messages.length, chars: JSON.stringify(messages).length })
      if (round === 1) {
        return [
          ...messages,
          {
            id: 'main-anchor',
            role: 'assistant',
            parts: [
              { type: 'step-start' },
              { type: 'text', text: 'X'.repeat(5000) },
              {
                type: 'tool-agent_ask_user',
                toolCallId: 'ask-main-1',
                state: 'input-available',
                input: {}
              } as never
            ]
          } as UIMessage
        ]
      }
      return [...messages, { id: 'a' + round, role: 'assistant', parts: [{ type: 'text', text: 'ok' }] } as UIMessage]
    })

    const agent = makeAgent(store)
    await agent.send(
      { sessionId: 'session', cwd: workspace, message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: '开始' }] } },
      sink()
    )
    await new Promise((r) => setTimeout(r, 50))

    const owner = store.lastMessage('session') as UIMessage
    const answer: UIMessage = {
      ...owner,
      parts: owner.parts.map((p) =>
        (p as { type: string; toolCallId?: string }).type === 'tool-agent_ask_user' &&
        (p as { toolCallId?: string }).toolCallId === 'ask-main-1'
          ? ({ ...p, state: 'output-available', output: '好的' } as never)
          : p
      )
    }
    const before = calls.length
    await agent.send({ sessionId: 'session', cwd: workspace, message: answer }, sink())
    await new Promise((r) => setTimeout(r, 50))

    // 主链轮：续写应含主链（≥2 条），行为与修复前一致
    expect(calls[before].count).toBeGreaterThanOrEqual(2)
    store.dispose()
  })

  it('普通用户提问（不含已答 ask_user）→ 不误判为续写，行为不变', async () => {
    const store = newStore('plain')
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
    expect(calls[0].count).toBe(1)
    store.dispose()
  })

  it('toolCallId 在库中找不到 → 回退旧路径，不抛错', async () => {
    const store = newStore('orphan')
    let called = false
    mocks.run.mockImplementation(async (messages: UIMessage[]) => {
      called = true
      return [...messages, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] } as UIMessage]
    })
    const agent = makeAgent(store)
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
    expect(called).toBe(true)
    store.dispose()
  })
})
