import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'uitarget-double-reset-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { SessionStore } from '../../../../src/main/core/session/store'

/**
 * 端到端守门：**同一会话内连续两次主链 reset**（全链复用同一 `uiTargetId`）。
 *
 * 回归背景：`locateCurrentRow` 的 reset 分支旧判据是 `response.id === continuationOf?.id`。
 * 解 A 后 `uiOriginalMessages` 末条是渲染端权威的 `uiTargetId` ⇒ AI SDK 令 `response.id = uiTargetId`。
 * **首次 reset** 时 `uiTargetId` 恰 = `continuationOf.id`（渲染端末端就是 reset 前那条）故能命中；
 * **第二次 reset** 时 `continuationOf` 已是**上一轮 reset 新行**，而 `uiTargetId` 仍是渲染端那条**旧 id**
 * ⇒ 二者不等 ⇒ 旧判据落空 ⇒ 产出写回 `response.id`（其库内行**已被上一轮 `deleteBeforeStart` 删掉**）
 * ⇒ 该轮 reset 行与上一轮 reset 行**同时可见** ⇒ **同一轮 UI 重复复发**（DB 型）。
 *
 * 修法：reset 轮的唯一可靠标志是 `resetStoredId`（由 `isCompaction` 决定，与 id 来源无关）。
 * 本测试锁死「连续两次 reset 后：每次换新行落库、回报的新 id 被下游复用、模型输入可读到最新产出」。
 */
const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })

const streamOf = (n: number, prefix: string): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          for (let i = 0; i < n; i++) {
            controller.enqueue({ type: 'text-start', id: `${prefix}t${i}` })
            controller.enqueue({ type: 'text-delta', id: `${prefix}t${i}`, delta: `内容${i}` })
            controller.enqueue({ type: 'text-end', id: `${prefix}t${i}` })
          }
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

describe('解 A 守门：连续两次 reset 各换新行、模型输入可续', () => {
  const sessionId = 's-double-reset'
  let store: SessionStore
  const open: SessionStore[] = []
  const sent: { id?: string; parts: number }[] = []
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    store = new SessionStore(join(workspace, `m-${Math.random().toString(36).slice(2)}.db`))
    open.push(store)
    store.createSession({ cwd: workspace, id: sessionId, title: 't' })
    sent.length = 0
    const sessionMod = await import('../../../../src/main/core/agent/session')
    spy = vi.spyOn(sessionMod, 'runAgentSession')
    // 忠实模拟 AI SDK 的 `getResponseUIMessageId` + `createStreamingUIMessageState`：
    // - 末条**是 assistant** ⇒ 复用其 id、克隆其整份 parts 作流式基线（再追加本轮增量）；
    // - 末条**不是 assistant**（reset 续写轮：末条是 compaction user）⇒ 用 `generateMessageId()`
    //   （= 第 7 参 `responseId`）、从**空**起构（`{id, parts: []}`）、再追加本轮增量。
    spy.mockImplementation(async (_m, _o, _c, saveResponse, uiOriginalMessages, _b, responseId) => {
      const anchor = uiOriginalMessages?.at(-1)
      sent.push({ id: anchor?.id, parts: anchor?.parts.length ?? -1 })
      const isAssistant = anchor?.role === 'assistant'
      const mark = `δ-${sent.length}`
      const resp: UIMessage = {
        id: isAssistant ? anchor.id : (responseId ?? `gen-${sent.length}`),
        role: 'assistant',
        parts: [
          ...(isAssistant ? (anchor.parts ?? []) : []),
          { type: 'text', text: `${mark}a` },
          { type: 'text', text: `${mark}b` }
        ]
      }
      saveResponse?.(resp)
      return [resp]
    })
  })
  afterEach(() => {
    spy?.mockRestore()
    for (const s of open.splice(0)) s.dispose()
  })

  it('新提问 → reset → reset：每次换新行落库，模型输入可读到最新产出', async () => {
    const { runStoredAgentSession } = await import('../../../../src/main/core/agent/persist')

    // 轮1：新提问 ⇒ 渲染端新建 G。
    const r1 = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      options: { model: streamOf(2, 'r1') } as never,
      message: { id: 'u1', role: 'user', parts: [text('问')] } as UIMessage
    })
    const G = r1!.uiMessageId

    // 轮2：第一次 reset。
    const comp1: UIMessage = {
      id: 'c1',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('问'), text('# H1')]
    }
    store.saveStart(sessionId, comp1)
    const r2 = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: G,
      options: { model: streamOf(2, 'r2') } as never,
      message: comp1,
      previousStored: comp1
    })
    expect(r2!.stored.id).not.toBe(G) // 换新行落库

    // 轮3：第二次 reset（★ 回归点：旧判据在此落空 ⇒ 写回已被删的 G ⇒ 两行同时可见）。
    // ★ 根本修复后渲染端会**采纳 reset 的新 id**（流 start chunk 的 messageId）⇒ 本轮 uiTargetId
    //   自然是上一轮回报的 `uiMessageId`（= r2.stored.id），而非旧的 G。
    const comp2: UIMessage = {
      id: 'c2',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('问'), text('# H2')]
    }
    store.saveStart(sessionId, comp2)
    const r3 = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: r2!.uiMessageId,
      options: { model: streamOf(2, 'r3') } as never,
      message: comp2,
      previousStored: comp2
    })
    // 每次都换新行（不复用渲染端旧 id、也不复用上一轮 reset 行）。
    expect(r3!.stored.id).not.toBe(G)
    expect(r3!.stored.id).not.toBe(r2!.stored.id)
    // ★ 新语义：reset 轮把**落库新 id 回传为 UI id**（渲染端据此收敛到 start 之后）⇒ uiMessageId = stored.id。
    expect(r2!.uiMessageId).toBe(r2!.stored.id)
    expect(r3!.uiMessageId).toBe(r3!.stored.id)
    expect(r2!.uiMessageId).not.toBe(G)

    // ★ 可见 assistant 行 = 3 条（每轮一条），且**内容互不相同**（= 各轮增量，非重复副本）。
    //   背景：reset 落库已改为「只存本轮增量」（见 persist.ts reset 分支）⇒ 不再有「新行完整包含旧行」
    //   的超集链；旧行（历史）与新行（增量）同时可见 = **正常的多条回复**，非 UI 重复。
    const assistants = store.loadVisibleMessages(sessionId).filter((m) => m.role === 'assistant')
    expect(assistants.map((m) => m.id)).toEqual([r1!.stored.id, r2!.stored.id, r3!.stored.id])
    // 各轮**内容**互不相同（轮1 含 r1 的文本、轮2/3 各含本轮 δ）⇒ 不是超集副本。
    const textOf = (m: UIMessage): string =>
      m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('|')
    expect(new Set(assistants.map(textOf)).size).toBe(3)
    // 模型输入能读到最新产出（落在 start 之后）。
    const input = store.loadMessages(sessionId)
    expect(input.at(-1)?.id).toBe(r3!.stored.id)
  })
})
