import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'uitarget-e2e-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { SessionStore } from '../../../../src/main/core/session/store'

/**
 * 端到端守门：**解 A 的核心不变量**——「同一轮内，发给渲染层的 UI 消息 id 恒一致」。
 *
 * 这是「渲染端恒 `replaceMessage`、物理上不新增副本」的充要条件（AI SDK 的判据是
 * `流内 messageId === 渲染端 lastMessage.id`）。用**真实 `runStoredAgentSession`**（真实 AI SDK
 * 语义）+ spy `runAgentSession` 抓每轮 `uiOriginalMessages` 末条 id。
 *
 * 覆盖全场景：新提问 → nest → nest 内 ask 续写 → 主链 reset 续写 → reset 后再 nest。
 *
 * ⚠️ **关键回归（本测试捕捉）**：**主链 reset 续写**轮，`saveStart` 会把 `sessions.start` 推过渲染端
 * 持有的那条 UI 消息（`G`，必然落在 `start` 之前）⇒ `findMessageById` 曾带 `position >= start` 过滤
 * ⇒ 查不到 `G` ⇒ 退化成 `previousStored`（compaction user）⇒ 流 id = `c1` ≠ 渲染端末端 `G`
 * ⇒ 渲染端 pushMessage ⇒ **reset 型重复复发**。故 `findMessageById` **绝不能**带 `position >= start`
 * 过滤（UI 身份与模型上下文的 `start` 游标无关）。
 */
const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })

const streamOf = (
  titles: string[],
  opts: { reset?: boolean; prefix: string }
): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          titles.forEach((t, i) => {
            controller.enqueue({ type: 'text-start', id: `${opts.prefix}t${i}` })
            controller.enqueue({ type: 'text-delta', id: `${opts.prefix}t${i}`, delta: `内容 ${t}` })
            controller.enqueue({ type: 'text-end', id: `${opts.prefix}t${i}` })
            const cid = `${opts.prefix}sp-${i}`
            controller.enqueue({ type: 'tool-input-start', id: cid, toolName: 'agent_show_progress' })
            controller.enqueue({ type: 'tool-input-delta', id: cid, delta: JSON.stringify({ title: t }) })
            controller.enqueue({ type: 'tool-input-end', id: cid })
          })
          if (opts.reset) {
            const rid = `${opts.prefix}reset`
            controller.enqueue({ type: 'tool-input-start', id: rid, toolName: 'agent_reset_context' })
            controller.enqueue({ type: 'tool-input-delta', id: rid, delta: JSON.stringify({ handoff: '摘要' }) })
            controller.enqueue({ type: 'tool-input-end', id: rid })
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

describe('解 A 端到端不变式：全链 UI 消息 id 恒一致（渲染端恒 replace）', () => {
  const sessionId = 's-e2e'
  const cwd = workspace
  let store: SessionStore
  const open: SessionStore[] = []
  const sent: (string | undefined)[] = []
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    store = new SessionStore(join(workspace, `m-${Math.random().toString(36).slice(2)}.db`))
    open.push(store)
    store.createSession({ cwd, id: sessionId, title: 'e2e' })
    sent.length = 0
    const sessionMod = await import('../../../../src/main/core/agent/session')
    spy = vi.spyOn(sessionMod, 'runAgentSession')
    // 用「AI SDK 会复用的 id」代替真实流：锚点末条 id 即流内 messageId；产出沿用该 id。
    spy.mockImplementation(async (_m, _o, _c, saveResponse, uiOriginalMessages) => {
      const anchor = uiOriginalMessages?.at(-1)
      sent.push(anchor?.id)
      const resp: UIMessage = {
        id: anchor?.id ?? `gen-${sent.length}`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'x' }]
      }
      saveResponse?.(resp)
      return [resp]
    })
  })
  afterEach(() => {
    spy?.mockRestore()
    for (const s of open.splice(0)) s.dispose()
  })

  it('新提问 → nest → nest 续写 → reset → reset 后 nest：messageId 全链恒 = 首轮新 id', async () => {
    const { runStoredAgentSession } = await import('../../../../src/main/core/agent/persist')

    // 轮1 新提问（渲染端不给 uiTargetId ⇒ 新建）
    const r1 = await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model: streamOf(['A'], { prefix: 'r1' }) } as never,
      message: { id: 'u1', role: 'user', parts: [text('问')] } as UIMessage
    })
    const G = r1!.uiMessageId
    expect(sent.at(-1)).toBeUndefined()

    // 轮2 nest（复用 G）
    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      nested: true,
      uiTargetId: G,
      options: { model: streamOf(['B'], { prefix: 'r2' }) } as never,
      message: {
        id: 'n1',
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [text('判据')]
      } as UIMessage
    })
    expect(sent.at(-1)).toBe(G)

    // 轮3 nest 续写（复用 G；带 previousStored）
    const nestedRow = store.lastVisibleAssistant(sessionId)!
    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      nested: true,
      uiTargetId: G,
      previousStored: nestedRow,
      options: { model: streamOf(['C'], { prefix: 'r3' }) } as never,
      message: { ...nestedRow, parts: [...nestedRow.parts, text('答')] }
    })
    expect(sent.at(-1)).toBe(G)

    // 轮4 主链 reset 续写（saveStart 把 start 推过 G ⇒ ★ 关键回归点）
    const comp: UIMessage = {
      id: 'c1',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('问'), text('# Handoff')]
    }
    store.saveStart(sessionId, comp)
    // reset 前：渲染端持有的那条 UI 消息 = 库里哪条 assistant？（= `continuationOf`）
    const preReset = store.lastAssistant(sessionId, 'before')
    const r4 = await runStoredAgentSession(store, {
      sessionId,
      cwd,
      uiTargetId: G,
      options: { model: streamOf(['D'], { prefix: 'r4' }) } as never,
      message: comp,
      previousStored: comp
    })
    // ★ 必须是 G，而非 c1。若 findMessageById 带 `position >= start` 过滤 ⇒ 此处会变成 c1。
    expect(sent.at(-1)).toBe(G)
    // ★ reset 分支仍在：产出落**新行**（`resetStoredId`），而非写回渲染端那条（G）。
    //   （reset 分支的判据是 `response.id === continuationOf?.id`；标准流程里 `uiTargetId` 恰等于
    //   `continuationOf.id`，故成立。若二者分歧 ⇒ 会落到「主链轮」分支、写回 `uiTargetId`。）
    expect(preReset?.id).toBe(G)
    expect(r4!.stored.id).not.toBe(G)
    // reset 用新版本**取代**旧行：G 那条被 `deleteBeforeStart` 删除。
    expect(store.findMessageById(sessionId, G)).toBeUndefined()

    // 轮5 reset 后 nest（继续复用 G）★ 此时 G 已被删 ⇒ 走 `lastVisibleAssistant` 兜底，
    //   底座 id 仍 = G、parts 非空（见 `ui-target-id-reset-superseded-base.test.ts`）。
    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      nested: true,
      uiTargetId: G,
      options: { model: streamOf(['E'], { prefix: 'r5' }) } as never,
      message: {
        id: 'n2',
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [text('判据2')]
      } as UIMessage
    })
    expect(sent.at(-1)).toBe(G)

    // 全链：仅首轮 undefined（新建），其余恒 G。
    expect(sent).toEqual([undefined, G, G, G, G])
  })
})
