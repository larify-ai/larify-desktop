import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('../../../../src/main/core/agent/messages', () => ({
  prepareMessages: (messages: UIMessage[]) => messages
}))
vi.mock('../../../../src/main/core/agent/session', () => ({
  runAgentSession: mocks.run
}))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

const directories: string[] = []
const message = (id: string, role: 'user' | 'assistant', text: string): UIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }]
})

// 主链上用户的真实输入落库时会带上 `workflowPrefix` 标记（送模型时才拼前缀，text 保持原文）。
const userMessage = (id = 'user', text = 'hello'): UIMessage => ({
  ...message(id, 'user', text),
  metadata: { workflowPrefix: true }
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function createStore(): Promise<SessionStore> {
  const directory = await mkdtemp(join(tmpdir(), 'larify-agent-persist-'))
  directories.push(directory)
  return new SessionStore(join(directory, 'sessions.db'))
}

describe('runStoredAgentSession persistence', () => {
  it('replaces the step snapshot with the complete final UIMessage and restores it after reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'larify-agent-persist-'))
    directories.push(directory)
    const database = join(directory, 'sessions.db')
    const user = userMessage()
    const step: UIMessage = {
      id: 'assistant',
      role: 'assistant',
      metadata: { startedAt: 1_000 },
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'checking' },
        { type: 'text', text: 'partial' }
      ]
    }
    const final: UIMessage = {
      ...step,
      metadata: { startedAt: 1_000, completedAt: 4_000 },
      parts: [
        ...step.parts,
        {
          type: 'data-git-snapshot',
          id: 'review',
          data: {
            files: [
              {
                additions: 1,
                binary: false,
                deletions: 0,
                patch: '@@ -0,0 +1 @@\n+saved\n',
                path: 'saved.txt'
              }
            ],
            root: '/workspace'
          }
        } as never,
        { type: 'text', text: 'complete' }
      ]
    }
    mocks.run.mockImplementation(async (messages, _options, _onChunk, onMessage) => {
      onMessage(step)
      return [...messages, final]
    })

    const store = new SessionStore(database)
    await expect(
      runStoredAgentSession(store, {
        sessionId: 'session',
        cwd: '/workspace',
        message: user,
        options: {} as never
      })
    ).resolves.toEqual({
      stored: final,
      reviewRowId: final.id,
      reviewRow: final,
      uiMessageId: final.id
    })
    expect(store.loadMessages('session')).toEqual([user, final])
    store.dispose()

    const reopened = new SessionStore(database)
    expect(reopened.loadMessages('session')).toEqual([user, final])
    reopened.dispose()
  })

  it('restores a persisted final Git patch after reopening the session store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'larify-agent-persist-'))
    directories.push(directory)
    const database = join(directory, 'sessions.db')
    const assistant: UIMessage = {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'data-git-snapshot',
          id: 'review',
          data: {
            files: [
              {
                additions: 1,
                binary: false,
                deletions: 0,
                patch: '@@ -0,0 +1 @@\n+saved\n',
                path: 'saved.txt'
              }
            ],
            root: '/workspace'
          }
        } as never
      ]
    }
    const first = new SessionStore(database)
    first.createSession({ cwd: '/workspace', id: 'session', title: 'Session' })
    first.saveMessages('session', [assistant])
    first.dispose()

    const reopened = new SessionStore(database)
    expect(reopened.loadMessages('session')).toEqual([assistant])
    reopened.dispose()
  })

  it('uses persisted ordering and does not duplicate a retried request', async () => {
    const store = await createStore()
    const user = userMessage()
    const firstResponse = message('assistant-1', 'assistant', 'first')
    const secondResponse = message('assistant-2', 'assistant', 'second')
    mocks.run
      .mockImplementationOnce(async (messages, _options, _onChunk, onMessage) => {
        expect(messages).toEqual([user])
        onMessage(firstResponse)
        return [user, firstResponse]
      })
      .mockImplementationOnce(async (messages, _options, _onChunk, onMessage) => {
        expect(messages).toEqual([user, firstResponse])
        onMessage(secondResponse)
        return [user, firstResponse, secondResponse]
      })

    const request = {
      sessionId: 'session',
      cwd: '/workspace',
      message: user,
      options: {} as never
    }
    await runStoredAgentSession(store, request)
    await runStoredAgentSession(store, request)

    expect(store.loadMessages('session')).toEqual([user, firstResponse, secondResponse])
    store.dispose()
  })

  it('writes a nested ask_user continuation back into the same row (no duplicate, no new id)', async () => {
    // 回归：子任务轮（nested）里 ask_user 提问后，用户回答经 addToolOutput 再次 send()。
    // 该轮必须**写回原来那条嵌套行**（原地替换），而非新建一条 —— 否则 UI 会多出一条
    // （实测：`#3192` 提问 + `#3193` 回答并列，用户看到"重复"）。
    // 关键：渲染层传来的 message 是**主链 assistant** 的快照（不含嵌套行身份），
    // 故必须由 agent.ts 下传 previousStored。
    //
    // ⚠️ 落库行 = **完整模型输出快照**（不再按长度切片）：AI SDK 对已有 part 是**按
    // toolCallId 原地改写**（`updateToolPart` 命中即不 push），故「用户回答」表现为原 part
    // 就地变 `output-available`；旧实现 `slice(nestedRow.parts.length)` 恰好把它切掉
    // （实测 `#6843` 48→10 parts，问答永久消失）。本用例据此断言**不变量**而非切片长度。
    const store = await createStore()
    const anchor: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main work' }]
    }
    const nestedRow: UIMessage = {
      id: 'main-nested-aaaa',
      role: 'assistant',
      metadata: { nested: true, totalProcessingMs: 100 },
      parts: [
        { type: 'text', text: 'nested question' },
        { type: 'tool-agent_ask_user', toolCallId: 'call-1', state: 'input-available', input: {} }
      ]
    }
    store.createSession({ cwd: '/workspace', id: 'session', title: 'Session' })
    store.saveMessages('session', [anchor, nestedRow])

    // 回答续写：渲染层发来的是含 tool-output 的**主链 assistant**（id 与主链相同）。
    const answer: UIMessage = {
      ...anchor,
      parts: [...anchor.parts, { type: 'text', text: 'answer' }]
    }
    // AI SDK 的真实返回：**同一 part 原地**变 `output-available`，之后才追加本轮增量。
    const continued: UIMessage = {
      id: nestedRow.id,
      role: 'assistant',
      parts: [
        { type: 'text', text: 'nested question' },
        {
          type: 'tool-agent_ask_user',
          toolCallId: 'call-1',
          state: 'output-available',
          output: 'ok'
        },
        { type: 'text', text: 'done' }
      ]
    }
    mocks.run.mockImplementation(async (messages, _options, _onChunk, onMessage) => {
      expect(messages).toEqual([answer])
      onMessage(continued)
      return [continued]
    })

    await runStoredAgentSession(store, {
      sessionId: 'session',
      cwd: '/workspace',
      message: answer,
      nested: true,
      previousStored: nestedRow,
      options: {} as never
    })

    const rows = store.loadVisibleMessages('session')
    // 仍未新增行：主链 assistant + 那条嵌套行，共 2 条。
    expect(rows.map((row) => row.id)).toEqual(['main', 'main-nested-aaaa'])
    const stored = rows.find((row) => row.id === 'main-nested-aaaa') as UIMessage
    // 原地替换：保留 nested 标记与总时长。
    expect(stored.metadata).toMatchObject({ nested: true })
    // **不变量**：落库行是完整快照 —— 已答的 ask_user 问答配对必须保留（旧切片会丢掉它）。
    expect(stored.parts).toEqual(continued.parts)
    expect(
      stored.parts.some(
        (part) =>
          (part as { toolCallId?: string }).toolCallId === 'call-1' &&
          (part as { state?: string }).state === 'output-available'
      ),
      '已答的 ask_user 问答配对必须保留'
    ).toBe(true)
    store.dispose()
  })

  it('keeps the nested id stable across many rounds (main-chain base, never chained)', async () => {
    // 回归：会话 31b06fa6 实测嵌套行 id **每轮追加一个后缀**（`#6496→#6520`：60→588 字符）。
    // 根因：旧实现（`nestStoredMessage`，已删）用 AI SDK 流响应 id（= UI 锚点 id = **上一轮那条
    // 嵌套行**）当 base ⇒ 每轮再挂一个 `-nested-<uuid>`。正解：id base 用**主链行**
    // （`lastAssistant('after')`）。
    // 全程模拟 AI SDK 的「复用锚点 id + parts 合并」返回。
    const store = await createStore()
    const mainAnchor: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main' }]
    }
    store.createSession({ cwd: '/workspace', id: 'session', title: 'Session' })
    store.saveMessages('session', [mainAnchor])

    let visible = mainAnchor
    for (let round = 1; round <= 3; round += 1) {
      const captured = visible
      mocks.run.mockImplementationOnce(async () => [
        {
          ...captured,
          parts: [...captured.parts, { type: 'text', text: `round ${round}` }]
        } as UIMessage
      ])
      await runStoredAgentSession(store, {
        sessionId: 'session',
        cwd: '/workspace',
        message: {
          id: `nest-${round}`,
          role: 'user',
          metadata: { nested: true, compaction: true },
          parts: [{ type: 'text', text: `task ${round}` }]
        },
        nested: true,
        options: {} as never
      })
      visible = store.lastVisibleAssistant('session') as UIMessage
    }

    const nestedAssistants = store
      .loadVisibleMessages('session')
      .filter(
        (row) =>
          row.role === 'assistant' &&
          (row.metadata as { nested?: boolean } | undefined)?.nested === true
      )
    expect(nestedAssistants.length).toBe(3)
    for (const row of nestedAssistants) {
      // id 恒为 `main-nested-<uuid>`：`-nested-` 只出现一次，绝不链式累积。
      expect(row.id.split('-nested-').length - 1).toBe(1)
      expect(row.id).toMatch(/^main-nested-.+/)
    }
    store.dispose()
  })

  it('never leaks a nested assistant into the main-chain context (even with no prior assistant row)', async () => {
    // 回归：会话 31b06fa6 的 `#6518`（1543 parts / 3.75MB）**没有 nested 标记**，被 `loadMessages`
    // 当成主链输入 ⇒ 下一轮上下文超限（输入 1,044,509 tokens）。
    // 根因：旧实现（`nestStoredMessage`，已删）的 `if (!anchor) return tag(value)`——锚点取不到时
    // assistant 被**原样落库**（不标 nested、不切片）。这里模拟「nest 当轮即是会话第一条」的最坏路径。
    const store = await createStore()
    mocks.run.mockImplementationOnce(async () => [
      {
        id: 'whatever',
        role: 'assistant',
        parts: [{ type: 'text', text: 'huge nested output' }]
      }
    ])
    await runStoredAgentSession(store, {
      sessionId: 'session',
      cwd: '/workspace',
      message: {
        id: 'nest',
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [{ type: 'text', text: 'task' }]
      },
      nested: true,
      options: {} as never
    })

    // 嵌套轮 assistant 必须带 nested 标记，且**不进** `loadMessages`（主链输入）。
    const visibleAssistant = store
      .loadVisibleMessages('session')
      .find((row) => row.role === 'assistant') as UIMessage
    expect(visibleAssistant).toBeDefined()
    expect(visibleAssistant.metadata).toMatchObject({ nested: true })
    expect(store.loadMessages('session').some((row) => row.role === 'assistant')).toBe(false)
    store.dispose()
  })

  it('keeps the request when execution fails', async () => {
    const store = await createStore()
    const user = userMessage()
    mocks.run.mockRejectedValue(new Error('failed'))

    await expect(
      runStoredAgentSession(store, {
        sessionId: 'session',
        cwd: '/workspace',
        message: user,
        options: {} as never
      })
    ).rejects.toThrow('failed')

    expect(store.loadMessages('session')).toEqual([user])
    store.dispose()
  })
})
