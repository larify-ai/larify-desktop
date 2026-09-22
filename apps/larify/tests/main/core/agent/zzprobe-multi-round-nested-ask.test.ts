import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'probe-multiround-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 多轮复现：嵌套行里模型**每轮都再问一次**（模拟真实会话 da3ad8bb#6921 的形态）。
 * 观察：回答是否落回（该 toolCallId → output-available）+ 是否无限累积 input-available。
 */
describe('多轮嵌套 ask 累积', () => {
  const sessionId = 's-multi'
  const cwd = workspace
  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const ask = (
    id: string,
    state = 'input-available',
    extra?: Record<string, unknown>
  ): UIMessage['parts'][number] =>
    ({
      type: 'tool-agent_ask_user',
      toolCallId: id,
      state,
      input: { question: 'q' },
      ...extra
    }) as never

  /** 打桩模型：每个 run 都产出一个**新 toolCallId 的 ask**（模拟“又问一遍”）。 */
  const modelAsking = (callId: string): MockLanguageModelV4 =>
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 't1' })
            controller.enqueue({ type: 'text-delta', id: 't1', delta: '再确认一下' })
            controller.enqueue({ type: 'text-end', id: 't1' })
            controller.enqueue({
              type: 'tool-input-start',
              id: callId,
              toolName: 'agent_ask_user'
            })
            controller.enqueue({
              type: 'tool-input-delta',
              id: callId,
              delta: JSON.stringify({ message: '再确认一下' })
            })
            controller.enqueue({ type: 'tool-input-end', id: callId })
            controller.enqueue({
              type: 'finish',
              finishReason: 'tool-calls',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
            })
            controller.close()
          }
        })
      })
    })

  let store: SessionStore
  const openStores: SessionStore[] = []
  beforeEach(() => {
    store = new SessionStore(join(workspace, `m-${Math.random().toString(36).slice(2)}.db`))
    openStores.push(store)
    store.createSession({ cwd, id: sessionId, title: '多轮' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  const rowById = (id: string): UIMessage | undefined =>
    store.loadVisibleMessages(sessionId).find((m) => m.id === id)
  const asksOf = (m: UIMessage | undefined): string[] =>
    (m?.parts ?? [])
      .filter((p) => (p as { type: string }).type === 'tool-agent_ask_user')
      .map((p) => `${(p as { toolCallId: string }).toolCallId}:${(p as { state: string }).state}`)

  it('三轮续写：每轮回答都落回，累积 input-available 数量恒 ≤ 1', async () => {
    store.saveMessages(sessionId, [
      { id: 'main-anchor', role: 'assistant', parts: [text('主链')] } as UIMessage
    ])
    // 初始嵌套行：模型问 ask-0
    store.saveMessages(sessionId, [
      {
        id: 'main-anchor-nested-A',
        role: 'assistant',
        parts: [ask('ask-0')],
        metadata: { nested: true }
      } as UIMessage
    ])

    for (let round = 0; round < 3; round += 1) {
      const stored = rowById('main-anchor-nested-A')!
      const answeredId = `ask-${round}`
      // 渲染层快照：addToolOutput 把**当前那个** ask 写成 output-available。
      // 注意：快照 id 用**主链锚点**（真实渲染层形态），parts = 合并视图（含嵌套内容 + 回答 + 主链）。
      const snapshot: UIMessage = {
        id: 'main-anchor',
        role: 'assistant',
        parts: [
          text('主链文本（快照携带，不应注入嵌套行）'),
          ...(stored.parts ?? []).map((p) =>
            (p as { toolCallId?: string }).toolCallId === answeredId
              ? ask(answeredId, 'output-available', { output: { answers: [`答案${round}`] } })
              : p
          )
        ]
      }
      await runStoredAgentSession(store, {
        sessionId,
        cwd,
        options: { model: modelAsking(`ask-${round + 1}`) } as never,
        nested: true,
        previousStored: stored,
        answeredToolCallId: answeredId,
        message: snapshot
      })
      const after = rowById('main-anchor-nested-A')!
      console.log(
        `[round ${round}] asks =`,
        asksOf(after),
        'mainAsk =',
        asksOf(rowById('main-anchor'))
      )
      const pending = asksOf(after).filter((s) => s.endsWith(':input-available')).length
      expect(asksOf(after)).toContain(`${answeredId}:output-available`)
      expect(pending).toBeLessThanOrEqual(1)
      // 主链行不得被注入嵌套内容
      expect(asksOf(rowById('main-anchor'))).toEqual([])
    }
  })
})
