import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'nested-multi-round-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 守门测试：**多轮连续续写**（模型每轮都再问一次）—— 这是最接近真实的形态
 * （真实 `da3ad8bb#6921` 一行 10 个 ask、`825617b9` 12 连嵌套轮）。
 *
 * 锁两条：
 * ① **历史单调累积**：第 N 轮输入含第 1…N 轮的全部工作记录（不丢、不重复）；
 * ② **每轮回答都落回** + 无孤儿/缺配对（喂回历史不得中断流）。
 */
describe('嵌套续写多轮：历史累积 + 每轮回答落回', () => {
  let store: SessionStore
  const sessionId = 's-multi-round'
  const cwd = workspace

  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const stepStart = (): UIMessage['parts'][number] => ({ type: 'step-start' })
  const tool = (id: string, marker: string): UIMessage['parts'][number] =>
    ({ type: 'tool-fs_read', toolCallId: id, state: 'output-available', input: {}, output: { c: marker } }) as never
  const ask = (id: string, state: string, extra: Record<string, unknown> = {}): UIMessage['parts'][number] =>
    ({ type: 'tool-agent_ask_user', toolCallId: id, state, input: { message: `Q-${id}` }, ...extra }) as never

  const openStores: SessionStore[] = []
  beforeEach(() => {
    store = new SessionStore(join(workspace, `mr-${Math.random().toString(36).slice(2)}.db`))
    openStores.push(store)
    store.createSession({ cwd, id: sessionId, title: 'multi-round' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  const rowById = (id: string): UIMessage | undefined =>
    store.loadVisibleMessages(sessionId).find((m) => m.id === id)

  it('三轮续写：历史累积、回答落回、每轮 call/result 配对', async () => {
    store.saveMessages(sessionId, [
      { id: 'main-anchor', role: 'assistant', parts: [text('主链')] } as UIMessage
    ])
    // 初始嵌套行：本嵌套轮的起始记录（模型问 ask-0）
    store.saveMessages(sessionId, [
      {
        id: 'main-anchor-nested-A',
        role: 'assistant',
        metadata: { nested: true },
        parts: [stepStart(), tool('t0', 'MARK-0'), ask('ask-0', 'input-available')]
      } as UIMessage
    ])

    const capturedPerRound: string[] = []
    for (let round = 0; round < 3; round += 1) {
      const stored = rowById('main-anchor-nested-A')!
      const answeredId = `ask-${round}`
      const nestPrompt: UIMessage = {
        id: 'p',
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [text(`判据-${round}`)]
      }
      store.saveMessages(sessionId, [nestPrompt])

      // 渲染层快照：把当前那个 ask 写成已答（真实 `addToolOutput` 形态）
      const snapshot: UIMessage = {
        id: 'main-anchor',
        role: 'assistant',
        parts: [
          text('主链'),
          ...(stored.parts ?? []).map((p) =>
            (p as { toolCallId?: string }).toolCallId === answeredId
              ? ask(answeredId, 'output-available', { output: { answers: [`A${round}`] } })
              : p
          )
        ]
      }

      const captured: unknown[][] = []
      const errors: string[] = []
      const model = new MockLanguageModelV4({
        doStream: async (options: { prompt: unknown[] }) => {
          captured.push(options.prompt)
          return {
            stream: new ReadableStream({
              start(c) {
                c.enqueue({ type: 'stream-start', warnings: [] })
                c.enqueue({ type: 'text-start', id: 't1' })
                // 每轮先留下一段「工作记录」（文本带 MARK），再问一次（模拟真实形态）。
                c.enqueue({ type: 'text-delta', id: 't1', delta: `WORK-MARK-${round + 1}` })
                c.enqueue({ type: 'text-end', id: 't1' })
                c.enqueue({ type: 'tool-input-start', id: `ask-${round + 1}`, toolName: 'agent_ask_user' })
                c.enqueue({
                  type: 'tool-input-delta',
                  id: `ask-${round + 1}`,
                  delta: JSON.stringify({ message: `Q-${round + 1}` })
                })
                c.enqueue({ type: 'tool-input-end', id: `ask-${round + 1}` })
                c.enqueue({
                  type: 'finish',
                  finishReason: 'tool-calls',
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
                })
                c.close()
              }
            })
          }
        }
      })

      const toolPart = tool(`t${round + 1}`, `MARK-${round + 1}`)
      await runStoredAgentSession(store, {
        sessionId,
        cwd,
        options: { model } as never,
        nested: true,
        previousStored: stored,
        continuationPrompt: nestPrompt,
        answeredToolCallId: answeredId,
        message: snapshot,
        onChunk: (chunk) => {
          if ((chunk as { type?: string }).type === 'error') errors.push(String(chunk))
        }
      })
      void toolPart

      const inputText = JSON.stringify(captured)
      capturedPerRound.push(inputText)

      // ② 无 error、每轮回答落回
      expect(errors, `第 ${round} 轮不得有 error chunk`).toHaveLength(0)
      const after = rowById('main-anchor-nested-A')!
      const askStates = (after.parts ?? [])
        .filter((p) => (p as { type: string }).type === 'tool-agent_ask_user')
        .map((p) => `${(p as { toolCallId?: string }).toolCallId}:${(p as { state?: string }).state}`)
      expect(askStates).toContain(`${answeredId}:output-available`)
      // 主链未被污染
      expect(
        (rowById('main-anchor')?.parts ?? []).some((p) => (p as { type: string }).type.startsWith('tool-'))
      ).toBe(false)

      // ① 历史累积：本轮输入应含「初始记录 MARK-0」+ 此前每轮的工作记录 WORK-MARK-k + 本判据
      expect(inputText, '初始记录 MARK-0 应一直在').toContain('MARK-0')
      for (let k = 1; k <= round; k += 1) {
        expect(inputText, `第 ${round} 轮输入应含第 ${k} 轮的工作记录`).toContain(`WORK-MARK-${k}`)
      }
      expect(inputText).toContain(`判据-${round}`)

      // 配对完整性
      const prompt = captured[0] as Array<{ role: string; content: unknown[] }>
      const calls: string[] = []
      const results: string[] = []
      for (const m of prompt) {
        for (const part of m.content as Array<Record<string, unknown>>) {
          if (part.type === 'tool-call') calls.push(String(part.toolCallId))
          if (part.type === 'tool-result') results.push(String(part.toolCallId))
        }
      }
      expect(calls.sort(), `第 ${round} 轮 call/result 必须配对`).toEqual(results.sort())
    }

    console.log('\n[每轮输入规模] =', capturedPerRound.map((s) => s.length))
  })
})
