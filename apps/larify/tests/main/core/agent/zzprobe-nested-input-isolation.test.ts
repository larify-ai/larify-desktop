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
 * 复核隔离：嵌套续写轮的**模型输入**不得携带整条主链。
 *
 * 输入形态 = `[nest 判据, 承载行自己的运行记录, 回答 part]`（2026-09 起；此前为
 * `[判据, 回答 part]` —— 那会把该嵌套轮已跑过的历史丢掉，致模型从 workflow 起点重跑，
 * 见 `memory/larify-desktop/ask-user-replays-nest-prompt-restarts-workflow.md`）。
 *
 * 关键不变量：**隔离**（不含主链）+ **体积与主链规模无关**（只与本嵌套轮自身规模成正比）。
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

  it('嵌套续写输入 = [判据, 承载行运行记录, 回答]：不含主链内容，且体积与主链规模无关', async () => {
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
    // **语义已更新（2026-09）**：续写输入从「只含 `[判据, 回答]`」改为
    // 「`[判据, 承载行自己的运行记录, 回答]`」——让模型**从该嵌套轮断点继续**，
    // 而非按判据重跑整条 workflow（原行为见
    // `memory/larify-desktop/ask-user-replays-nest-prompt-restarts-workflow.md`）。
    //
    // 仍必须守的不变量：
    // ① 每轮输入都**不得**含主链内容（`modelCapturing` 内部已有断言）——隔离不破；
    // ② 体积**与主链规模无关**（主链塞 200×『主链机密内容-』也不该让输入变大），
    //    只与本嵌套轮自身规模成正比。
    const sizes = captured.map((c) => c.chars)
    expect(sizes.length).toBe(3)
    expect(Math.max(...sizes)).toBeLessThan(2000)
    expect(captured.every((c) => c.chars < 2000)).toBe(true)
  })
})
