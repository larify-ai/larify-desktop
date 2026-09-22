import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LanguageModelV2Prompt, LanguageModelV3Prompt, UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'probe-isolation-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 复核隔离：嵌套续写轮的**模型输入**不得携带整条主链（只应含 [nest 判据, 回答 part]）。
 * 并在多轮下确认输入体积不随时间膨胀。
 */
describe('嵌套续写模型输入的隔离', () => {
  const sessionId = 's-iso'
  const cwd = workspace
  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const ask = (
    id: string,
    state = 'input-available',
    extra?: Record<string, unknown>
  ): UIMessage['parts'][number] =>
    ({ type: 'tool-agent_ask_user', toolCallId: id, state, input: { question: 'q' }, ...extra }) as never

  const captured: Array<{ role: string; chars: number }> = []

  const modelCapturing = (callId: string): MockLanguageModelV4 =>
    new MockLanguageModelV4({
      doStream: async (opts: {
        prompt: (LanguageModelV2Prompt | LanguageModelV3Prompt)[number][]
      }) => {
        const flat = JSON.stringify(opts.prompt)
        captured.push({ role: 'all', chars: flat.length })
        expect(flat).not.toContain('主链机密内容')
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] })
              controller.enqueue({ type: 'text-start', id: 't1' })
              controller.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' })
              controller.enqueue({ type: 'text-end', id: 't1' })
              controller.enqueue({
                type: 'tool-input-start',
                id: callId,
                toolName: 'agent_ask_user'
              })
              controller.enqueue({
                type: 'tool-input-delta',
                id: callId,
                delta: JSON.stringify({ message: '再问' })
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
        }
      }
    })

  let store: SessionStore
  const openStores: SessionStore[] = []
  beforeEach(() => {
    captured.length = 0
    store = new SessionStore(join(workspace, `i-${Math.random().toString(36).slice(2)}.db`))
    openStores.push(store)
    store.createSession({ cwd, id: sessionId, title: '隔离' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  const rowById = (id: string): UIMessage | undefined =>
    store.loadVisibleMessages(sessionId).find((m) => m.id === id)

  it('嵌套续写输入只含 [判据, 回答]，不含主链内容，且三轮不膨胀', async () => {
    // 主链含一段「机密」文本（若被越权带入嵌套轮，断言会红）
    store.saveMessages(sessionId, [
      {
        id: 'main-anchor',
        role: 'assistant',
        parts: [text('主链机密内容-'.repeat(200))],
        metadata: {}
      } as UIMessage
    ])
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
      const prompt: UIMessage = {
        id: 'prompt',
        role: 'user',
        parts: [{ type: 'text', text: 'nest 判据（完成某 task.md）' }],
        metadata: { nested: true, compaction: true }
      }
      const snapshot: UIMessage = {
        id: 'main-anchor',
        role: 'assistant',
        parts: [
          text('主链机密内容-'.repeat(200)),
          ask(answeredId, 'output-available', { output: { answers: [`答案${round}`] } })
        ]
      }
      await runStoredAgentSession(store, {
        sessionId,
        cwd,
        options: { model: modelCapturing(`ask-${round + 1}`) } as never,
        nested: true,
        previousStored: stored,
        continuationPrompt: prompt,
        answeredToolCallId: answeredId,
        message: snapshot
      })
    }

    console.log('[captured chars per round] =', captured.map((c) => c.chars))
    // 每轮输入都不得含主链机密内容（modelCapturing 内部有断言）；且体积稳定（无膨胀）
    const sizes = captured.map((c) => c.chars)
    expect(sizes.length).toBe(3)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(400)
    expect(Math.max(...sizes)).toBeLessThan(2000)
  })
})
