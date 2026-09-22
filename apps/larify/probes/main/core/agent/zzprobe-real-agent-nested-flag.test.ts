import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'probe-real-agent-'))
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
  GitSnapshotService: class { start = vi.fn(async () => null); compare = vi.fn(async () => null) }
}))

import { Agent } from '../../../../src/main/core/agent/agent'
import type { AgentSink } from '../../../../src/main/core/agent/worker'
import { SessionStore } from '../../../../src/main/core/session'

function sink(): AgentSink { return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() } }

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

describe('真实 Agent 复现：nested 轮 ask_user 续写是否丢 nested 标记', () => {
  it('nested 轮 ask_user → 回答 → 检查承载行 nested 是否保留、id 是否双层', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-real-agent-db-'))
    const store = new SessionStore(join(dir, 'sessions.db'))
    store.createSession({ cwd: workspace, id: 'session', title: 'T' })

    const MAIN: UIMessage['parts'] = [
      { type: 'step-start' },
      { type: 'text', text: 'main work' }
    ]
    let round = 0
    mocks.run.mockImplementation(async (messages: UIMessage[], options: { toolsContext?: Record<string, unknown> }) => {
      round += 1
      if (round === 1) {
        // 主链轮：schedule 一个子任务
        ;(options.toolsContext?.agent_schedule_task as { scheduleTask: (p: string) => void }).scheduleTask('C:/tasks/sub/task.md')
        return [...messages, { id: 'main-anchor', role: 'assistant', parts: [...MAIN] } as UIMessage]
      }
      if (round === 2) {
        // 子任务轮：先干活，再 ask_user（input-available）
        return [...messages, {
          id: 'main-anchor', role: 'assistant',
          parts: [...MAIN, { type: 'step-start' }, { type: 'text', text: 'nested work' },
            { type: 'tool-agent_ask_user', toolCallId: 'ask-n', state: 'input-available', input: { message: 'q?' } } as never]
        } as UIMessage]
      }
      // round 3: 回答续写 —— 模拟 AI SDK：复用锚点 id、原地把 ask_user 改成 output-available、再追加增量
      const anchor = store.lastMessage('session') as UIMessage
      return [{
        ...anchor,
        parts: [...anchor.parts.map(p => (p as any).toolCallId === 'ask-n' ? { ...p, state: 'output-available', output: { answers: ['回答'] } } : p),
          { type: 'step-start' }, { type: 'text', text: 'after answer' }]
      } as UIMessage]
    })

    const agent = new Agent(store as never, { refreshPlugins: vi.fn(async () => undefined) } as never)
    await agent.send({ sessionId: 'session', cwd: workspace, message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] } }, sink())
    await new Promise(r => setTimeout(r, 60))

    console.log('\n=== 轮1+2 后 ===')
    store.loadVisibleMessages('session').forEach(r => console.log(`  ${r.id} role=${r.role} nest=${(r.metadata as any)?.nested} N=${r.parts.length}`))

    // 模拟用户回答：渲染层 addToolOutput → 把回答写进「主链 assistant」（id=main-anchor）
    const mainRow = store.loadVisibleMessages('session').find(r => r.id === 'main-anchor')!
    const answer: UIMessage = {
      ...mainRow,
      parts: [...mainRow.parts.map(p => (p as any).toolCallId === 'ask-n' ? { ...p, state: 'output-available', output: { answers: ['回答'] } } : p)]
    }
    await agent.send({ sessionId: 'session', cwd: workspace, message: answer }, sink())
    await new Promise(r => setTimeout(r, 60))

    console.log('\n=== 回答续写后 ===')
    store.loadVisibleMessages('session').forEach(r => console.log(`  ${r.id} role=${r.role} nest=${(r.metadata as any)?.nested} N=${r.parts.length}`))
    console.log('主链 loadMessages =', store.loadMessages('session').map(r => `${r.id}(nest=${(r.metadata as any)?.nested},N=${r.parts.length})`))

    for (const r of store.loadVisibleMessages('session')) {
      if (r.id.includes('-nested-')) {
        console.log(`  → 泄漏?  ${r.id}: nest=${(r.metadata as any)?.nested}, -nested- 次数=${r.id.split('-nested-').length - 1}`)
      }
    }
    store.dispose()
    expect(true).toBe(true)
  })
})
