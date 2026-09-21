import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'ask-user-cont-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ run: vi.fn(), runtime: vi.fn() }))
vi.mock('../../../../src/main/core/agent/session', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/main/core/agent/session')>(
    '../../../../src/main/core/agent/session'
  )
  return { ...actual, runAgentSession: mocks.run }
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

function sink(): AgentSink {
  return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
}
function newStore(name: string): SessionStore {
  const path = join(workspace, `${name}.db`)
  rmSync(path, { force: true })
  const store = new SessionStore(path)
  store.createSession({ cwd: workspace, id: 'session', title: 'T' })
  return store
}
const MAIN: UIMessage['parts'] = [
  { type: 'step-start' },
  { type: 'text', text: 'M'.repeat(30000) }, // 巨型主链
  { type: 'tool-agent_schedule_task', toolCallId: 's1', state: 'output-available', input: {}, output: 'ok' } as never
]

interface Seen {
  count: number
  roles: string[]
  texts: string[]
  chars: number[]
}

function record(): Seen[] {
  return []
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

describe('ask_user 续写的上下文（子任务轮应续上「判据 + 回答」）', () => {
  it('子任务轮 ask_user → 回答续写送 [nest 判据, 回答]（2 条；含判据、不含整条主链）', async () => {
    const store = newStore('nested')
    const seen = record()
    let round = 0
    mocks.run.mockImplementation(
      async (messages: UIMessage[], options: { toolsContext?: Record<string, unknown> }) => {
        round += 1
        seen.push({
          count: messages.length,
          roles: messages.map((m) => m.role),
          texts: messages.map((m) =>
            (m.parts ?? [])
              .filter((p) => p.type === 'text')
              .map((p) => (p as { text: string }).text.slice(0, 60))
              .join('|')
          ),
          chars: messages.map((m) => JSON.stringify(m).length)
        })
        if (round === 1) {
          ;(options.toolsContext?.agent_schedule_task as { scheduleTask: (p: string) => void }).scheduleTask(
            'C:/tasks/sub/task.md'
          )
          return [...messages, { id: 'main-anchor', role: 'assistant', parts: [...MAIN] } as UIMessage]
        }
        if (round === 2) {
          return [
            ...messages,
            {
              id: 'main-anchor',
              role: 'assistant',
              parts: [
                ...MAIN,
                { type: 'step-start' },
                { type: 'text', text: 'nested work' },
                { type: 'tool-agent_ask_user', toolCallId: 'ask-n', state: 'input-available', input: {} } as never
              ]
            } as UIMessage
          ]
        }
        return [
          ...messages,
          {
            id: 'main-anchor',
            role: 'assistant',
            parts: [
              ...MAIN,
              { type: 'step-start' },
              { type: 'text', text: 'nested work' },
              { type: 'tool-agent_ask_user', toolCallId: 'ask-n', state: 'output-available', input: {}, output: 'A' } as never,
              { type: 'step-start' },
              { type: 'text', text: 'done' }
            ]
          } as UIMessage
        ]
      }
    )

    const agent = new Agent(store as never, { refreshPlugins: vi.fn(async () => undefined) } as never)
    await agent.send(
      { sessionId: 'session', cwd: workspace, message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] } },
      sink()
    )
    await new Promise((r) => setTimeout(r, 40))

    // 取子任务轮的嵌套行作为 owner，构造回答
    const nestedRow = store
      .loadVisibleMessages('session')
      .find((m) => m.metadata?.nested === true && m.role === 'assistant') as UIMessage
    expect(nestedRow, '应存在嵌套行').toBeDefined()
    const answer: UIMessage = {
      ...nestedRow,
      parts: nestedRow.parts.map((p) =>
        (p as { type: string; toolCallId?: string }).type === 'tool-agent_ask_user' &&
        (p as { toolCallId?: string }).toolCallId === 'ask-n'
          ? ({ ...p, state: 'output-available', output: 'A' } as never)
          : p
      )
    }
    const before = seen.length
    await agent.send({ sessionId: 'session', cwd: workspace, message: answer }, sink())
    await new Promise((r) => setTimeout(r, 40))

    const cont = seen[before]
    console.log('\n子任务轮续写：', JSON.stringify(cont))
    expect(cont, '续写应调用模型').toBeDefined()
    // ★ 应送 2 条：nest 判据 + 回答（**不是**整条主链）
    expect(cont.count).toBe(2)
    expect(cont.roles).toEqual(['user', 'assistant'])
    expect(cont.texts[0]).toContain('To complete the current task')
    // 不含巨型主链
    expect(cont.chars.every((c) => c < 30000)).toBe(true)
    store.dispose()
  })

  it('主链轮 ask_user 续写 → 送整条主链（行为不变）', async () => {
    const store = newStore('main')
    const seen = record()
    let round = 0
    mocks.run.mockImplementation(async (messages: UIMessage[]) => {
      round += 1
      seen.push({
        count: messages.length,
        roles: messages.map((m) => m.role),
        texts: [],
        chars: messages.map((m) => JSON.stringify(m).length)
      })
      if (round === 1) {
        return [
          ...messages,
          {
            id: 'main-anchor',
            role: 'assistant',
            parts: [
              { type: 'step-start' },
              { type: 'text', text: 'hello' },
              { type: 'tool-agent_ask_user', toolCallId: 'ask-m', state: 'input-available', input: {} } as never
            ]
          } as UIMessage
        ]
      }
      return [...messages, { id: 'a' + round, role: 'assistant', parts: [{ type: 'text', text: 'ok' }] } as UIMessage]
    })
    const agent = new Agent(store as never, { refreshPlugins: vi.fn(async () => undefined) } as never)
    await agent.send(
      { sessionId: 'session', cwd: workspace, message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] } },
      sink()
    )
    await new Promise((r) => setTimeout(r, 40))
    const owner = store.lastMessage('session') as UIMessage
    const answer: UIMessage = {
      ...owner,
      parts: owner.parts.map((p) =>
        (p as { type: string; toolCallId?: string }).type === 'tool-agent_ask_user' &&
        (p as { toolCallId?: string }).toolCallId === 'ask-m'
          ? ({ ...p, state: 'output-available', output: 'y' } as never)
          : p
      )
    }
    const before = seen.length
    await agent.send({ sessionId: 'session', cwd: workspace, message: answer }, sink())
    await new Promise((r) => setTimeout(r, 40))
    expect(seen[before].count).toBeGreaterThanOrEqual(2)
    store.dispose()
  })

  it('普通用户提问 → 不误判续写（行为不变）', async () => {
    const store = newStore('plain')
    const seen = record()
    mocks.run.mockImplementation(async (messages: UIMessage[]) => {
      seen.push({
        count: messages.length,
        roles: messages.map((m) => m.role),
        texts: [],
        chars: []
      })
      return [...messages, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] } as UIMessage]
    })
    const agent = new Agent(store as never, { refreshPlugins: vi.fn(async () => undefined) } as never)
    await agent.send(
      { sessionId: 'session', cwd: workspace, message: { id: 'u', role: 'user', parts: [{ type: 'text', text: '你好' }] } },
      sink()
    )
    await new Promise((r) => setTimeout(r, 40))
    expect(seen[0].count).toBe(1)
    store.dispose()
  })

  it('toolCallId 找不到 → 回退（不抛错，仍调用模型）', async () => {
    const store = newStore('orphan')
    let called = false
    mocks.run.mockImplementation(async (messages: UIMessage[]) => {
      called = true
      return [...messages, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] } as UIMessage]
    })
    const agent = new Agent(store as never, { refreshPlugins: vi.fn(async () => undefined) } as never)
    const orphan: UIMessage = {
      id: 'orphan',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'x' },
        { type: 'tool-agent_ask_user', toolCallId: 'nope', state: 'output-available', output: 'ok' } as never
      ]
    }
    await agent.send({ sessionId: 'session', cwd: workspace, message: orphan }, sink())
    await new Promise((r) => setTimeout(r, 40))
    expect(called).toBe(true)
    store.dispose()
  })
})
