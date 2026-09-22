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
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})
async function createStore(): Promise<SessionStore> {
  const directory = await mkdtemp(join(tmpdir(), 'probe-nested-slice-'))
  directories.push(directory)
  const store = new SessionStore(join(directory, 'sessions.db'))
  store.createSession({ cwd: '/workspace', id: 'session', title: 'S' })
  return store
}

describe('复现：真实会话 e2212cc1 的嵌套续写丢 ask_user', () => {
  it('锚点末位是 input-available 的 ask_user；AI SDK 原地改写它 → 切片把它切掉', async () => {
    const store = await createStore()
    const main: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main work' }]
    }
    // 真实形状（#6843 被覆写前）：48 parts，**最后一个是等待回答的 ask_user**
    const anchor: UIMessage = {
      id: 'main-nested-2f8ce25c',
      role: 'assistant',
      metadata: { nested: true },
      parts: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
        { type: 'text', text: 'c' },
        { type: 'tool-agent_ask_user', toolCallId: 'call-ask', state: 'input-available', input: {} } as never
      ]
    }
    store.saveMessages('session', [main, anchor])

    // AI SDK 的真实行为：**在同一 part 上原地**把 state 改成 output-available（不追加新 part），
    // 然后才追加本轮的增量。用户回答时送来的 message 是主链快照（identity 与嵌套行不同）。
    const merged: UIMessage = {
      id: anchor.id,
      role: 'assistant',
      metadata: { nested: true },
      parts: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
        { type: 'text', text: 'c' },
        // ← 原地改写（同一 toolCallId）
        { type: 'tool-agent_ask_user', toolCallId: 'call-ask', state: 'output-available', input: {}, output: { answers: ['用户回答'] } } as never,
        { type: 'step-start' },
        { type: 'text', text: '后续工作' }
      ]
    }
    const answer: UIMessage = {
      ...main,
      parts: [
        ...main.parts,
        { type: 'tool-agent_ask_user', toolCallId: 'call-ask', state: 'output-available', input: {}, output: { answers: ['用户回答'] } } as never
      ]
    }
    mocks.run.mockImplementation(async (_messages, _options, _onChunk, onMessage) => {
      onMessage(merged)
      return [merged]
    })

    await runStoredAgentSession(store, {
      sessionId: 'session',
      cwd: '/workspace',
      message: answer,
      nested: true,
      previousStored: anchor,
      options: {} as never
    })

    const stored = store
      .loadVisibleMessages('session')
      .find((r) => r.id === anchor.id) as UIMessage
    console.log('\n落库行 parts =', JSON.stringify(stored.parts, null, 1))
    const hasAnswer = stored.parts.some(
      (p) =>
        (p as { toolCallId?: string }).toolCallId === 'call-ask' &&
        (p as { state?: string }).state === 'output-available'
    )
    console.log('落库行是否保留「已答的 ask_user」=', hasAnswer)
    expect(hasAnswer, '落库行应保留已答的 ask_user 问答配对').toBe(true)
    store.dispose()
  })
})
