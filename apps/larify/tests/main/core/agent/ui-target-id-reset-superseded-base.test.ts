import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'uitarget-superseded-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { SessionStore } from '../../../../src/main/core/session/store'

/**
 * 端到端守门：**reset 之后紧跟 nest**（同一 `uiTargetId` 被复用），渲染端**仍持有**那条 UI 消息。
 *
 * 回归背景：reset 续写会用 `deleteBeforeStart` **删掉被取代的旧行**（= 渲染端此刻持有的那条 UI 消息，
 * 因为 reset 轮是 `replaceLastMessage` 原地替换、id 不变）。此后该轮派生的 **nest 轮**复用同一
 * `uiTargetId` ⇒ **`findMessageById(uiTargetId)` 查不到**。
 *
 * 若此时退化成「**空 parts 占位**」当 UI 底座，AI SDK 会以空基线克隆消息
 * （`createStreamingUIMessageState({ lastMessage })`）⇒ 流出的 `state.message` 只含本轮新增、
 * 且 id 仍是渲染端那条 ⇒ 渲染端 `replaceLastMessage`（id 命中）**原地替换**、把渲染端那条的
 * 既有内容**清空**（live 态内容丢失）。
 *
 * 修法：查不到时退化为「**库内此刻末端 assistant 的 parts**」（`lastVisibleAssistant`，
 * 不过滤 nested），**但 id 恒取 `uiTargetId`**（身份正确、内容正确）。本测试锁死「底座 parts 非空」。
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

describe('解 A 守门：reset 取代旧行后，复用的 uiTargetId 底座不得为空', () => {
  const sessionId = 's-superseded'
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
    // ★ mock 必须**忠实复刻 AI SDK 的 id 语义**（`getResponseUIMessageId`）：
    //   - `originalMessages` 末条是 assistant ⇒ 复用其 id（= `uiTargetId` 底座）；
    //   - 否则（reset 续写的末条是 compaction user）⇒ 用 `generateMessageId()`（= 第 7 参 `responseId`
    //     = `resetStoredId`）。
    spy.mockImplementation(
      async (_m, _o, _c, saveResponse, uiOriginalMessages, _base, responseId) => {
        const anchor = uiOriginalMessages?.at(-1)
        sent.push({ id: anchor?.id, parts: anchor?.parts.length ?? -1 })
        const id =
          anchor?.role === 'assistant' ? anchor.id : (responseId ?? `gen-${sent.length}`)
        const resp: UIMessage = {
          id,
          role: 'assistant',
          parts: [{ type: 'text', text: 'round-output' }]
        }
        saveResponse?.(resp)
        return [resp]
      }
    )
  })
  afterEach(() => {
    spy?.mockRestore()
    for (const s of open.splice(0)) s.dispose()
  })

  it('新提问 → reset → nest：nest 轮的 UI 底座 id = reset 新 id 且 parts 非空（未被清空）', async () => {
    const { runStoredAgentSession } = await import('../../../../src/main/core/agent/persist')

    // 轮1：新提问（无 uiTargetId）⇒ 渲染端新建 G。
    const r1 = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      options: {} as never,
      message: { id: 'u1', role: 'user', parts: [text('问')] } as UIMessage
    })
    expect(sent.at(-1)).toEqual({ id: undefined, parts: -1 })

    // 轮2：主链 reset 续写（带 uiTargetId=渲染端新建的 G）⇒ 产出落新行、G 那条被甩到 start 之前。
    const G = r1!.uiMessageId
    const comp: UIMessage = {
      id: 'c1',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('问'), text('# Handoff')]
    }
    store.saveStart(sessionId, comp)
    const r2 = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: G,
      options: {} as never,
      message: comp,
      previousStored: comp
    })
    // ★ 根本修复后：reset 轮 UI 底座**末条不是 assistant**（= compaction user，无 id 底座）
    //   ⇒ 流 id 改由 `generateMessageId`（= reset 新行 id）决定 ⇒ 渲染端末端 id 收敛到 start 之后。
    expect(sent.at(-1)?.id).toBe('c1')
    expect(r2!.uiMessageId).toBe(r2!.stored.id)
    // 渲染端此刻持有的末端 id = reset 轮回报的 `r2.uiMessageId`（重置了 reset 新行，故库内存在）。
    const N = r2!.uiMessageId
    expect(store.findMessageById(sessionId, N)).toBeDefined()

    // 轮3：reset 后 nest（★ 渲染端下传 uiTargetId = N；nest 输入是 assistant 快照，模拟渲染端
    //      `addToolOutput` 后的快照行，故用 role='assistant' 以免被当 nest 判据打 nested 标记）。
    await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      nested: true,
      uiTargetId: N,
      options: {} as never,
      message: {
        id: N,
        role: 'assistant',
        parts: [text('reset 轮回报内容')]
      } as UIMessage
    })
    const last = sent.at(-1)!
    // ★ 底座 id = 渲染端此刻持有的 N（reset 新 id）。
    expect(last.id).toBe(N)
    // 探测：N 在库内存在（第一种画法）或已被甩到 start 之前（第二种画法，`findMessageById` 仍可命
    // 中因其不过滤 start）——两种画法都应由 `findMessageById(N)` 命中 ⇒ parts 非空。
    expect(last.parts).toBeGreaterThan(0)
  })
})
