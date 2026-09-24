import type { UIMessage } from 'ai'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const home = mkdtempSync(join(tmpdir(), 'larify-uitarget-'))
process.env.LARIFY_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ run: vi.fn(), runtime: vi.fn(), refreshPlugins: vi.fn() }))
// 保留真实 persist，仅 spy 其执行入口：断言「发给渲染层的 UI 身份」而非真实跑模型。
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

/** 每轮返回一个「发给渲染层的 UI id」：等价于 persist 的 `uiMessageId` 回报。 */
function stubRuns(
  sinkToRenderer: (call: number) => { uiMessageId: string; schedule?: string }
): void {
  let call = 0
  mocks.run.mockImplementation(async (_s, request) => {
    call += 1
    const { uiMessageId, schedule } = sinkToRenderer(call)
    if (schedule !== undefined) {
      const ctx = request.options.toolsContext.agent_schedule_task as {
        scheduleTask: (p: string) => void
      }
      ctx.scheduleTask(schedule)
    }
    return {
      stored: { id: `row-${call}`, role: 'assistant', parts: [] } as UIMessage,
      reviewRowId: `row-${call}`,
      reviewRow: { id: `row-${call}`, role: 'assistant', parts: [] } as UIMessage,
      uiMessageId
    }
  })
}

async function run(
  message: UIMessage,
  uiTargetId?: string
): Promise<{
  sink: { chunk: ReturnType<typeof vi.fn>; error: unknown; end: ReturnType<typeof vi.fn> }
}> {
  const store = newStore()
  const sink = { chunk: vi.fn(), error: vi.fn(), end: vi.fn() }
  const agent = new Agent(store, { refreshPlugins: mocks.refreshPlugins } as never)
  agent.send({ sessionId: 's', message, cwd: 'cwd', uiTargetId }, sink as never)
  await vi.waitFor(() => expect(sink.end).toHaveBeenCalled(), { timeout: 3000 })
  return { sink }
}

const user = (id: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: 'go' }]
})

// 本文件覆盖「编排层/worker 的传话」不变式：渲染端下传的 `uiTargetId` 会不会被整条链复用。
// 「persist 把 uiOriginalMessages 末条 id 设成 uiTargetId」由 persist.test.ts 的真 persist 覆盖。
describe('uiTargetId 编排层传话：渲染端下传的 id 被整条链复用', () => {
  it('ask_user 续写（渲染端下传 uiTargetId）：主链唯一条 UI 消息、全链复用同一 id', async () => {
    // 渲染端下传 `uiTargetId='assistant-x'`：主链轮与该轮派生的 nest 轮都必须复用同一个 id，
    // 且 `uiOriginalMessages` 末条 id 恒 = 它 ⇒ 渲染端必然 replace、不新增副本。
    stubRuns((call) =>
      call === 1
        ? { uiMessageId: 'assistant-x', schedule: join(taskRoot, 'child', 'task.md') }
        : { uiMessageId: 'assistant-x' }
    )
    await run({ id: 'answer', role: 'assistant', parts: [] } as UIMessage, 'assistant-x')

    expect(mocks.run).toHaveBeenCalledTimes(2)
    for (const [, request] of mocks.run.mock.calls) {
      expect((request as { uiTargetId?: string }).uiTargetId).toBe('assistant-x')
    }
  })

  it('新提问 + nest：无 uiTargetId ⇒ 首轮回报新 id，nest 内部轮复用它（不退回从 DB 猜）', async () => {
    // 渲染端给 `undefined`（新提问）。首轮 persist 回报 AI SDK 自生成的新 id `generated-1`；
    // 该轮派生的 nest 轮**必须复用它**，否则 nest 退回无 uiTargetId ⇒ 又从 DB 猜 ⇒ 可能重复。
    stubRuns((call) =>
      call === 1
        ? { uiMessageId: 'generated-1', schedule: join(taskRoot, 'child', 'task.md') }
        : { uiMessageId: 'generated-1' }
    )
    await run(user('u1'), undefined)

    expect(mocks.run).toHaveBeenCalledTimes(2)
    expect((mocks.run.mock.calls[0][1] as { uiTargetId?: string }).uiTargetId).toBeUndefined()
    // ★ 关键：nest 内部轮拿到了首轮回报的 id。
    expect((mocks.run.mock.calls[1][1] as { uiTargetId?: string }).uiTargetId).toBe('generated-1')
  })

  it('连续两轮新提问：各自 undefined ⇒ 两条独立 UI 消息（不并进上一轮）', async () => {
    stubRuns(() => ({ uiMessageId: 'generated-n' }))
    await run(user('u1'), undefined)
    await run(user('u2'), undefined)
    // 两轮都不带 uiTargetId ⇒ 渲染端各新建一条。
    expect(mocks.run).toHaveBeenCalledTimes(2)
    for (const [, request] of mocks.run.mock.calls) {
      expect((request as { uiTargetId?: string }).uiTargetId).toBeUndefined()
    }
  })
})
