import type { UIMessage } from 'ai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const home = mkdtempSync(join(tmpdir(), 'larify-anchor-'))
process.env.LARIFY_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ run: vi.fn(), runtime: vi.fn(), refreshPlugins: vi.fn() }))
// 保留真实 persist（markNested 等），仅替换其执行入口；真实 SessionStore 参与。
vi.mock('../../../../src/main/core/agent/persist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/core/agent/persist')>()
  return { ...actual, runStoredAgentSession: mocks.run }
})
vi.mock('../../../../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.runtime }))

import { Agent } from '../../../../src/main/core/agent/agent'
import { SessionStore } from '../../../../src/main/core/session/store'

const taskRoot = join(home, '.larify', 'tasks')
const stores: SessionStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runtime.mockReturnValue({
    system: 'runtime',
    toolsContext: {
      agent_schedule_task: { sessionId: 's', cwd: 'cwd' },
      agent_reset_context: { sessionId: 's', cwd: 'cwd' }
    }
  })
})

function newStore(): SessionStore {
  const store = new SessionStore(join(home, `s-${Math.random().toString(36).slice(2)}.db`))
  stores.push(store)
  store.createSession({ id: 's', title: 't', cwd: 'cwd' })
  return store
}

describe('Agent nested anchor', () => {
  it('treats a top-level taskPath as top-level even when separators/casing differ', async () => {
    // 顶层任务路径常被模型写成正斜杠（Windows 下 larifyPath 是反斜杠）或有大小写差异；
    // 归一化比较后才能判为顶层、走「主链续跑」而非「下探」。
    const store = newStore()
    store.saveMessages('s', [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] } as UIMessage,
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'main' }] } as UIMessage
    ])
    const top = `${taskRoot.replaceAll('\\', '/').toUpperCase()}/ROOT/task.md`
    const phases: Array<{ nested?: boolean; hasMessage: boolean }> = []
    let runs = 0
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      phases.push({ nested: request.nested, hasMessage: request.message !== undefined })
      const ctx = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (p: string) => void
      }
      if (runs === 1) ctx.scheduleTask(top)
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(store, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      { sessionId: 's', message: { id: 'u2', role: 'user', parts: [] } as UIMessage, cwd: 'cwd' },
      sink
    )
    await vi.waitFor(() => expect(sink.end).toHaveBeenCalled(), { timeout: 3000 })

    // run1 主链；run2 判为顶层 → 主链续跑（nested=false、无新消息）。
    expect(phases[1]).toEqual({ nested: false, hasMessage: false })
  })

  it('does not crash and passes no UI anchor when the session has no main-chain assistant yet', async () => {
    // 极端：会话里还没有任何主链 assistant（如首轮即下探）。锚点缺失时应正常退回。
    const store = newStore()
    const child = join(taskRoot, 'root', 'child', 'task.md')
    let runs = 0
    mocks.run.mockImplementation(async (_s, request) => {
      runs++
      const ctx = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (p: string) => void
      }
      if (runs === 1) ctx.scheduleTask(child)
      return undefined
    })
    const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
    const agent = new Agent(store, { refreshPlugins: mocks.refreshPlugins } as never)
    agent.send(
      { sessionId: 's', message: { id: 'u', role: 'user', parts: [] } as UIMessage, cwd: 'cwd' },
      sink
    )
    await vi.waitFor(() => expect(sink.end).toHaveBeenCalled(), { timeout: 3000 })

    expect(runs).toBe(2)
    // nested 轮仍走独立上下文；因无锚点，uiOriginalMessages（第 5 参）为 undefined。
    expect(mocks.run.mock.calls[1][1].nested).toBe(true)
    expect(mocks.run.mock.calls[1][4]).toBeUndefined()
  })
})
