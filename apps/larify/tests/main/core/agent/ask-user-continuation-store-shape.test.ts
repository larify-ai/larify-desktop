import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('渲染层快照 id = 主链锚点时：主链行不得被写入（不污染主链上下文）', async () => {
    // 真实渲染层形态：`addToolOutput` 把回答写在**当前 UI assistant** 上，其 id 是**主链锚点**
    // （AI SDK 复用 `originalMessages` 末条 assistant 的 id），而其 parts 已把嵌套行内容合并进来。
    // 若按该 id 落库（`ON CONFLICT(session_id,id) DO UPDATE`），会把子任务内容+回答**注入主链行**，
    // 而 `loadMessages` 只读主链行 ⇒ 模型越权读到子任务上下文（实测 `main-anchor` N=2→5）。
    const path = join(workspace, 'shape2.db')
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

    const mainBefore = store.loadVisibleMessages('session').find((m) => m.id === 'main-anchor')!
    // ★ 真实渲染层形态：id = 主链锚点；parts = 主链 + 嵌套内容已合并 + 回答。
    const rendererSnapshot: UIMessage = {
      id: 'main-anchor',
      role: 'assistant',
      parts: [
        ...MAIN,
        { type: 'step-start' },
        { type: 'text', text: 'nested work' },
        { type: 'tool-agent_ask_user', toolCallId: 'ask-n', state: 'output-available', input: {}, output: 'A' } as never
      ]
    }
    await agent.send({ sessionId: 'session', cwd: workspace, message: rendererSnapshot }, sink())
    await new Promise((r) => setTimeout(r, 40))

    const mainAfter = store.loadVisibleMessages('session').find((m) => m.id === 'main-anchor')!
    console.log('\n主链行 before N=', mainBefore.parts.length, ' after N=', mainAfter.parts.length)
    // ★ 主链行必须保持不变（未被渲染层快照覆写）。
    expect(mainAfter.parts).toEqual(mainBefore.parts)
    // ★ 回答只落在嵌套行。
    const carrier = store
      .loadVisibleMessages('session')
      .filter((m) =>
        (m.parts ?? []).some(
          (p) =>
            (p as { toolCallId?: string }).toolCallId === 'ask-n' &&
            (p as { state?: string }).state === 'output-available'
        )
      )
      .map((m) => m.id)
    expect(carrier).toHaveLength(1)
    expect(carrier[0]).toContain('-nested-')
    store.dispose()
  })

  it('子任务轮改文件时：变更卡片回流主链行，且不得把嵌套私货或 nested 标记写进主链行', async () => {
    // 回归（本次修复引入的第三层缺陷）：`worker.saveReview` 曾用 `result.stored`（嵌套行：带
    // nested 标记、parts 为含嵌套私货的完整快照）去配 `reviewRowId`（主链行 id）落库 ⇒ 主链行
    // 被写成「nested=true + 嵌套正文 + 嵌套工具 part + 卡片」⇒ `loadMessages`（过滤 nested）
    // 把主链助手行整个吞掉，主链上下文残缺。修法：卡片目标行的 **id 与内容基线必须同源**
    // （`reviewRowId` + `reviewRow`，`reviewRow` 取主链行本身）。
    const path = join(workspace, 'shape3.db')
    rmSync(path, { force: true })
    const store = new SessionStore(path)
    store.createSession({ cwd: workspace, id: 'session', title: 'T' })
    const touched = join(workspace, 'touched.txt')

    let round = 0
    mocks.run.mockImplementation(
      async (messages: UIMessage[], options: { toolsContext?: Record<string, unknown> }) => {
        round += 1
        if (round === 1) {
          ;(
            options.toolsContext?.agent_schedule_task as { scheduleTask: (p: string) => void }
          ).scheduleTask('C:/tasks/sub/task.md')
          return [...messages, { id: 'main-anchor', role: 'assistant', parts: [...MAIN] } as UIMessage]
        }
        // 子任务轮：真的改一个文件（走 trackFileChange），随后不再调度 ⇒ 链结束。
        const ctx = options.toolsContext?.fs_write as {
          trackFileChange?: (m: { path: string; before: string | null; after: string }) => void
        }
        writeFileSync(touched, 'hello')
        ctx.trackFileChange?.({ path: touched, before: null, after: 'hello' })
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
                input: { path: touched },
                output: { path: touched }
              } as never
            ]
          } as UIMessage
        ]
      }
    )

    // 让 runtime 带 fs_write，worker 才会把文件变更收进会话级追踪器。
    mocks.runtime.mockReturnValue({
      system: 'runtime',
      toolsContext: {
        agent_ask_user: { sessionId: 'session' },
        agent_schedule_task: { sessionId: 'session' },
        fs_write: { sessionId: 'session' }
      }
    })

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
    // ① 主链行不得带 nested 标记（否则被 loadMessages 过滤，主链助手消失）。
    expect((main.metadata as Record<string, unknown> | undefined)?.nested).toBeUndefined()
    // ② 主链行不得含嵌套正文 / 嵌套工具 part。
    const texts = (main.parts ?? [])
      .filter((p) => (p as { type: string }).type === 'text')
      .map((p) => (p as { text?: string }).text)
    expect(texts).toEqual(['MAIN'])
    expect((main.parts ?? []).some((p) => (p as { toolCallId?: string }).toolCallId === 'w1')).toBe(
      false
    )
    // ③ 变更卡片仍回流到主链行（卡片只渲染主链消息）。
    expect(
      (main.parts ?? []).some((p) => (p as { type?: string }).type === 'data-git-snapshot')
    ).toBe(true)
    // ④ 主链上下文仍完整（含该主链助手行）。
    const mainChainIds = store.loadMessages('session').map((m) => m.id)
    expect(mainChainIds).toContain('main-anchor')
    store.dispose()
  })
})
