// 复现（决定论，不触网）：同一 assistant 行内「同一个问题被问两次」。
// 真实 Agent + 真实 SessionStore + 真实 persist + 打桩 runAgentSession（控制模型每步输出）。
// 关键：探针模型每次被调用都请求问同一个问题；观察第 2 轮（用户已答 call_1）后
// 出现的 ask_user 数量。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'two-rounds-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ run: vi.fn(), runtime: vi.fn() }))
vi.mock('../../../../src/main/core/agent/session', async () => {
  const actual =
    await vi.importActual<typeof import('../../../../src/main/core/agent/session')>(
      '../../../../src/main/core/agent/session'
    )
  return { ...actual, runAgentSession: mocks.run }
})
vi.mock('../../../../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.runtime }))
vi.mock('../../main/utils/app-paths', () => ({
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
import { SessionStore } from '../../../../src/main/core/session/store'

const QUESTION = '你想要哪个方案？'

function sink(): AgentSink {
  return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
}

/** 每次模型调用都「产出一次 ask_user」，与探针模型行为一致。 */
function makeRun(): {
  run: ReturnType<typeof vi.fn>
  prompts: UIMessage[][]
} {
  const prompts: UIMessage[][] = []
  let n = 0
  const run = vi.fn(async (messages: UIMessage[]) => {
    prompts.push(messages)
    n += 1
    const last = messages.at(-1) as UIMessage
    const part: UIMessage['parts'][number] = {
      type: 'tool-agent_ask_user',
      toolCallId: `call_${n}`,
      state: 'input-available',
      input: { message: QUESTION, toolCallTitle: '问他' }
    } as never
    // 落库身份：末条若是 assistant 则在其上累积（= 同一行内多步），否则新建
    if (last?.role === 'assistant') {
      return [...messages.slice(0, -1), { ...last, parts: [...last.parts, part] } as UIMessage]
    }
    return [...messages, { id: 'a1', role: 'assistant', parts: [part] } as UIMessage]
  })
  return { run, prompts }
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

function newStore(name: string): SessionStore {
  const path = join(workspace, `${name}.db`)
  rmSync(path, { force: true })
  const store = new SessionStore(path)
  store.createSession({ cwd: workspace, id: 'session', title: 'T' })
  return store
}

describe('复现：同一个问题被问两次', () => {
  it('用户答完后模型又产出第二个 ask_user → 两次提问只有最后一个可交互', async () => {
    const store = newStore('two')
    const probe = makeRun()
    mocks.run.mockImplementation(probe.run)

    const agent = new Agent(store as never, {
      refreshPlugins: vi.fn(async () => undefined)
    } as never)

    // 第 1 轮：用户提问 → 模型第一次 ask
    await agent.send(
      {
        sessionId: 'session',
        cwd: workspace,
        message: { id: 'u', role: 'user', parts: [{ type: 'text', text: '开始' }] }
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 40))

    const afterFirst = store.lastMessage('session') as UIMessage
    console.log('\n=== 第 1 轮后 ===')
    console.log('行 =', afterFirst.role, 'parts =', afterFirst.parts.length)
    console.log(
      'ask_user =',
      afterFirst.parts
        .filter((p) => (p as { type?: string }).type === 'tool-agent_ask_user')
        .map((p) => (p as { toolCallId?: string; state?: string }).toolCallId + ':' + (p as { state?: string }).state)
    )

    // 第 2 轮：用户回答 call_1（模拟 addToolOutput 后 send）
    const answered: UIMessage = {
      ...afterFirst,
      parts: afterFirst.parts.map((p) =>
        (p as { type?: string; toolCallId?: string }).type === 'tool-agent_ask_user' &&
        (p as { toolCallId?: string }).toolCallId === 'call_1'
          ? ({ ...p, state: 'output-available', output: { answers: ['方案A'] } } as never)
          : p
      )
    }
    await agent.send({ sessionId: 'session', cwd: workspace, message: answered }, sink())
    await new Promise((r) => setTimeout(r, 40))

    const row = store.lastMessage('session') as UIMessage
    const asks = row.parts.filter((p) => (p as { type?: string }).type === 'tool-agent_ask_user')
    console.log('\n=== 第 2 轮（用户已答）后 ===')
    console.log('行 parts =', row.parts.length)
    console.log(
      'ask_user =',
      asks.map(
        (p) =>
          (p as { toolCallId?: string }).toolCallId +
          ':' +
          (p as { state?: string }).state +
          ' 回答=' +
          JSON.stringify((p as { output?: unknown }).output ?? null)
      )
    )
    console.log('\n模型每步输入末尾：')
    probe.prompts.forEach((p, i) => {
      console.log(`  #${i + 1} 条数=${p.length} 末条 role=${p.at(-1)?.role}`)
    })

    // 现象：出现 2 个 ask_user，只有最后一个是等待态 → 用户「答了像没答」
    expect(asks.length, '第 2 轮后应出现两次提问（复现现象）').toBe(2)
    expect(
      asks.filter((p) => (p as { state?: string }).state === 'input-available').length,
      '只有最后一个停留为等待态'
    ).toBe(1)
    store.dispose()
  })
})
