import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'probe-baseline-'))
afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 复现 + 守门：嵌套行续写时，AI SDK 合并基线（`uiOriginalMessages`/`nestedAnchor`）若取**库内承载行**
 * （其 ask_user part 仍 `input-available`），会把用户回答（只存在于渲染层快照里、已 `output-available`）
 * **丢弃** ⇒ 承载行 part 恒停 `input-available` + 每轮再追加新 ask ⇒ 「反复问同一个问题」。
 *
 * 修法：把「渲染层送来的、已终态的 ask_user part」按 `toolCallId` 并入库内承载行后再当基线。
 */
describe('persist 基线补齐（嵌套行 ask_user 回答落回）', () => {
  let store: SessionStore
  const sessionId = 's-baseline'
  const cwd = workspace

  const ask = (toolCallId: string, question: string): UIMessage['parts'][number] =>
    ({
      type: 'tool-agent_ask_user',
      toolCallId,
      state: 'input-available',
      input: { question }
    }) as never
  const answeredAsk = (toolCallId: string, answer: string): UIMessage['parts'][number] =>
    ({
      type: 'tool-agent_ask_user',
      toolCallId,
      state: 'output-available',
      input: { question: 'q' },
      output: { answer }
    }) as never
  const text = (value: string): UIMessage['parts'][number] => ({ type: 'text', text: value })
  const stepStart = (): UIMessage['parts'][number] => ({ type: 'step-start' })

  const rowById = (id: string): UIMessage | undefined =>
    store.loadVisibleMessages(sessionId).find((m) => m.id === id)
  const asksOf = (message: UIMessage | undefined): string[] =>
    (message?.parts ?? [])
      .filter((part) => (part as { type: string }).type === 'tool-agent_ask_user')
      .map((part) => {
        const p = part as { toolCallId: string; state: string }
        return `${p.toolCallId}:${p.state}`
      })

  /** 打桩模型：只回一段文本（不像真实场景那样再问一次），便于观察回答是否落回。 */
  const textOnlyModel = (): MockLanguageModelV4 =>
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 't1' })
            controller.enqueue({ type: 'text-delta', id: 't1', delta: '好的' })
            controller.enqueue({ type: 'text-end', id: 't1' })
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
            })
            controller.close()
          }
        })
      })
    })

  const openStores: SessionStore[] = []
  beforeEach(() => {
    const path = join(workspace, `probe-${Math.random().toString(36).slice(2)}.db`)
    store = new SessionStore(path)
    openStores.push(store)
    store.createSession({ cwd, id: sessionId, title: '基线补齐' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  it('嵌套续写：回答按 toolCallId 并入库内承载行（不再恒停 input-available）', async () => {
    // 主链锚点行（供 nested id 基与卡片回流）
    store.saveMessages(sessionId, [
      { id: 'main-anchor', role: 'assistant', parts: [text('主链')] } as UIMessage
    ])
    // 库内嵌套承载行：ask-n 仍 input-available（用户尚未回答时的落库态）
    store.saveMessages(sessionId, [
      {
        id: 'main-anchor-nested-A',
        role: 'assistant',
        parts: [stepStart(), ask('ask-n', '你用什么形态？')],
        metadata: { nested: true }
      } as UIMessage
    ])
    const nestedRow = rowById('main-anchor-nested-A')!
    // 渲染层快照：addToolOutput 已把 ask-n 写成 output-available
    const uiSnapshot: UIMessage = {
      id: nestedRow.id,
      role: 'assistant',
      parts: [stepStart(), answeredAsk('ask-n', '戒指形态')],
      metadata: { nested: true }
    }

    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model: textOnlyModel() } as never,
      nested: true,
      previousStored: nestedRow,
      answeredToolCallId: 'ask-n',
      message: uiSnapshot
    })

    const stored = rowById('main-anchor-nested-A')
    console.log('[嵌套续写后] asks =', asksOf(stored))
    expect(asksOf(stored)).toContain('ask-n:output-available')
    expect(asksOf(stored)).not.toContain('ask-n:input-available')
    // 主链锚点行不得被污染
    expect(asksOf(rowById('main-anchor'))).toEqual([])
  })

  it('主链续写（对照正例，行为不变）：回答落回主链行', async () => {
    store.saveMessages(sessionId, [
      { id: 'u', role: 'user', parts: [text('把名字做成点云')] } as UIMessage,
      {
        id: 'main-anchor',
        role: 'assistant',
        parts: [stepStart(), ask('ask-m', '哪种点云？')],
        metadata: { totalProcessingMs: 100 }
      } as UIMessage
    ])
    const mainRow = rowById('main-anchor')!
    const uiSnapshot: UIMessage = {
      id: 'main-anchor',
      role: 'assistant',
      parts: [stepStart(), answeredAsk('ask-m', '中文点云')]
    }

    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model: textOnlyModel() } as never,
      previousStored: mainRow,
      answeredToolCallId: 'ask-m',
      message: uiSnapshot
    })

    const stored = rowById('main-anchor')
    console.log('[主链续写后] asks =', asksOf(stored))
    expect(asksOf(stored)).toContain('ask-m:output-available')
    expect(asksOf(stored)).not.toContain('ask-m:input-available')
  })
})
