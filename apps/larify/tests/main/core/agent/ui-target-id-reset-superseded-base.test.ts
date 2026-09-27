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
    spy.mockImplementation(async (_m, _o, _c, saveResponse, uiOriginalMessages) => {
      const anchor = uiOriginalMessages?.at(-1)
      sent.push({ id: anchor?.id, parts: anchor?.parts.length ?? -1 })
      const resp: UIMessage = {
        id: anchor?.id ?? `gen-${sent.length}`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'round-output' }]
      }
      saveResponse?.(resp)
      return [resp]
    })
  })
  afterEach(() => {
    spy?.mockRestore()
    for (const s of open.splice(0)) s.dispose()
  })

  it('新提问 → reset → nest：nest 轮的 UI 底座 id = G 且 parts 非空（未被清空）', async () => {
    const { runStoredAgentSession } = await import('../../../../src/main/core/agent/persist')

    // 轮1：新提问（无 uiTargetId）⇒ 渲染端新建 G。
    const r1 = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      options: {} as never,
      message: { id: 'u1', role: 'user', parts: [text('问')] } as UIMessage
    })
    const G = r1!.uiMessageId
    expect(sent.at(-1)).toEqual({ id: undefined, parts: -1 })

    // 轮2：主链 reset 续写（带 uiTargetId=G）⇒ 产出落新行、G 那条被 deleteBeforeStart 取代。
    const comp: UIMessage = {
      id: 'c1',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('问'), text('# Handoff')]
    }
    store.saveStart(sessionId, comp)
    await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: G,
      options: {} as never,
      message: comp,
      previousStored: comp
    })
    expect(sent.at(-1)?.id).toBe(G)
    // ★ 回归修复后：**不再删除 G**（reset 落库改为「只存本轮增量」，新行不再包含旧行 ⇒ 删旧行
    //   会丢历史）。故 G 仍在库 ⇒ `findMessageById(G)` 命中，nest 轮底座直接取 G（不再走兜底）。
    expect(store.findMessageById(sessionId, G)).toBeDefined()

    // 轮3：reset 后 nest（复用 G）⇒ 底座 id 仍 = G，但 parts 必须**非空**。
    await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      nested: true,
      uiTargetId: G,
      options: {} as never,
      message: {
        id: 'n1',
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [text('判据')]
      } as UIMessage
    })
    const last = sent.at(-1)!
    // ★ 修复前：parts = 0（空底座 ⇒ 渲染端 replace 清空既有内容）；修复后：> 0。
    expect(last.id).toBe(G)
    expect(last.parts).toBeGreaterThan(0)
  })
})
