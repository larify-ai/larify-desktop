import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'cont-shape-'))
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
const MAIN: UIMessage['parts'] = [
  { type: 'step-start' },
  { type: 'text', text: 'MAIN' },
  { type: 'tool-agent_schedule_task', toolCallId: 's1', state: 'output-available', input: {}, output: 'ok' } as never
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

describe('P2：子任务轮 ask_user 续写的落库形态（原地替换、无重复行）', () => {
  it('回答后：嵌套行 id 不变、parts 增长、保留 nested；无新增嵌套行', async () => {
    const path = join(workspace, 'shape.db')
    rmSync(path, { force: true })
    const store = new SessionStore(path)
    store.createSession({ cwd: workspace, id: 'session', title: 'T' })

    let round = 0
    mocks.run.mockImplementation(
      async (messages: UIMessage[], options: { toolsContext?: Record<string, unknown> }) => {
        round += 1
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
        // 回答续写：返回「锚点 parts + 增量」
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
              { type: 'text', text: 'FINAL' }
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

    const before = store
      .loadVisibleMessages('session')
      .filter((m) => m.metadata?.nested === true && m.role === 'assistant')
    expect(before).toHaveLength(1)
    const idBefore = before[0].id
    const partsBefore = before[0].parts.length

    const answer: UIMessage = {
      ...before[0],
      parts: before[0].parts.map((p) =>
        (p as { type: string; toolCallId?: string }).type === 'tool-agent_ask_user' &&
        (p as { toolCallId?: string }).toolCallId === 'ask-n'
          ? ({ ...p, state: 'output-available', output: 'A' } as never)
          : p
      )
    }
    await agent.send({ sessionId: 'session', cwd: workspace, message: answer }, sink())
    await new Promise((r) => setTimeout(r, 40))

    const after = store
      .loadVisibleMessages('session')
      .filter((m) => m.metadata?.nested === true && m.role === 'assistant')
    console.log('\n落库形态：before id=', idBefore, 'parts=', partsBefore, ' | after=', after.map((m) => `${m.id}:${m.parts.length}`))
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(idBefore)
    expect(after[0].parts.length).toBeGreaterThan(partsBefore)
    expect(after[0].metadata?.nested).toBe(true)
    store.dispose()
  })
})
