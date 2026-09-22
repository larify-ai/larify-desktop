import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'review-pollute-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

const mocks = vi.hoisted(() => ({ run: vi.fn(), runtime: vi.fn() }))
vi.mock('../src/main/core/agent/session', async () => {
  const actual =
    await vi.importActual<typeof import('../src/main/core/agent/session')>(
      '../src/main/core/agent/session'
    )
  return { ...actual, runAgentSession: mocks.run }
})
vi.mock('../src/main/core/agent/runtime', () => ({ createAgentRuntime: mocks.runtime }))
vi.mock('../src/main/utils/app-paths', () => ({
  larifyPath: (...s: string[]) => '~/.larify/' + s.join('/'),
  larifyWorkspacePath: () => workspace
}))
vi.mock('../src/main/core/git/snapshot', () => ({
  GitSnapshotService: class {
    start = vi.fn(async () => null)
    compare = vi.fn(async () => null)
  }
}))

import { Agent } from '../src/main/core/agent/agent'
import type { AgentSink } from '../src/main/core/agent/worker'
import { SessionStore } from '../src/main/core/session'

function sink(): AgentSink {
  return { chunk: vi.fn(), title: vi.fn(), error: vi.fn(), end: vi.fn() }
}
const MAIN: UIMessage['parts'] = [
  { type: 'step-start' },
  { type: 'text', text: 'MAIN' },
  {
    type: 'tool-agent_schedule_task',
    toolCallId: 's1',
    state: 'output-available',
    input: {},
    output: 'ok'
  } as never
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runtime.mockReturnValue({
    system: 'runtime',
    toolsContext: {
      agent_ask_user: { sessionId: 'session' },
      agent_schedule_task: { sessionId: 'session' },
      fs_write: { sessionId: 'session' }
    }
  })
})

describe('第三层缺陷候选：嵌套轮变更卡片是否把嵌套 parts 写入主链行', () => {
  it('嵌套轮改了文件 ⇒ 主链行 parts 是否被注入嵌套内容', async () => {
    const path = join(workspace, 'review.db')
    rmSync(path, { force: true })
    const store = new SessionStore(path)
    store.createSession({ cwd: workspace, id: 'session', title: 'T' })
    const target = join(workspace, 'touched.txt')

    let round = 0
    mocks.run.mockImplementation(
      async (
        messages: UIMessage[],
        options: { toolsContext?: Record<string, unknown> }
      ) => {
        round += 1
        if (round === 1) {
          ;(
            options.toolsContext?.agent_schedule_task as { scheduleTask: (p: string) => void }
          ).scheduleTask('C:/tasks/sub/task.md')
          return [
            ...messages,
            { id: 'main-anchor', role: 'assistant', parts: [...MAIN] } as UIMessage
          ]
        }
        // 嵌套轮：真的改一个文件（走 trackFileChange），随后不再调度 ⇒ 链结束。
        const ctx = options.toolsContext?.fs_write as {
          trackFileChange?: (m: { path: string; before: string | null; after: string }) => void
        }
        writeFileSync(target, 'hello')
        ctx.trackFileChange?.({ path: target, before: null, after: 'hello' })
        return [
          ...messages,
          {
            id: 'main-anchor',
            role: 'assistant',
            parts: [
              ...MAIN,
              { type: 'step-start' },
              { type: 'text', text: 'nested work' },
              {
                type: 'tool-fs_write',
                toolCallId: 'w1',
                state: 'output-available',
                input: { path: target },
                output: { path: target }
              } as never
            ]
          } as UIMessage
        ]
      }
    )

    const agent = new Agent(store as never, {
      refreshPlugins: vi.fn(async () => undefined)
    } as never)
    await agent.send(
      {
        sessionId: 'session',
        cwd: workspace,
        message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] }
      },
      sink()
    )
    await new Promise((r) => setTimeout(r, 80))

    const main = store.loadVisibleMessages('session').find((m) => m.id === 'main-anchor')!
    const mainTexts = (main.parts ?? [])
      .filter((p) => (p as { type: string; text?: string }).type === 'text')
      .map((p) => (p as { text?: string }).text)
    const hasNestedText = mainTexts.includes('nested work')
    const hasNestedWrite = (main.parts ?? []).some(
      (p) => (p as { toolCallId?: string }).toolCallId === 'w1'
    )
    const hasReviewCard = (main.parts ?? []).some(
      (p) => (p as { type?: string }).type === 'data-git-snapshot'
    )
    console.log('\n[probe] 主链行 parts =', main.parts.length)
    console.log('[probe] 主链行 text =', JSON.stringify(mainTexts))
    console.log('[probe] 含嵌套正文 "nested work" =', hasNestedText)
    console.log('[probe] 含嵌套写 toolCallId w1 =', hasNestedWrite)
    console.log('[probe] 含变更卡片 data-git-snapshot =', hasReviewCard)
    console.log(
      '[probe] 主链行 metadata.nested =',
      (main.metadata as Record<string, unknown> | undefined)?.nested
    )
    const mainChain = store.loadMessages('session')
    console.log(
      '[probe] loadMessages(主链上下文) ids =',
      mainChain.map((m) => m.id),
      ' 文本 =',
      JSON.stringify(
        mainChain.flatMap((m) =>
          (m.parts ?? [])
            .filter((p) => (p as { type: string }).type === 'text')
            .map((p) => (p as { text?: string }).text)
        )
      )
    )
    store.dispose()

    // 断言：主链行不得含嵌套正文（不污染主链上下文）
    expect(hasNestedText).toBe(false)
  })
})
