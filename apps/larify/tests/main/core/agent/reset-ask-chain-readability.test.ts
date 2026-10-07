import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'reset-askchain-'))
afterAll(() => {
  try {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    /* Windows 下 DB 句柄可能仍占用 */
  }
})

import { SessionStore } from '../../../../src/main/core/session/store'

const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
const askPart = (
  id: string,
  state: 'input-available' | 'output-available'
): UIMessage['parts'][number] =>
  ({
    type: 'tool-agent_ask_user',
    toolCallId: id,
    state,
    input: { message: `Q-${id}` },
    ...(state === 'output-available' ? { output: { answers: ['A'] } } : {})
  }) as never

/**
 * 复刻真实会话 `f97e2d22`「四轮足运控资料」的形态：
 *   提问 → ask1 → 回答 → reset → ask2 → 回答 → ask3
 * 不变量：**每次回答之后，承载「最新未答 ask」的行必须能被 `loadMessages` 读到**
 * （即落在 `sessions.start` 之后）。HEAD 上此不变量在第 3 个 ask 处破裂。
 */
describe('复刻真实形态：reset 后 ask 链的可读性（f97e2d22）', () => {
  const sessionId = 's-real'
  let store: SessionStore
  const open: SessionStore[] = []
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    store = new SessionStore(join(workspace, `m-${Math.random().toString(36).slice(2)}.db`))
    open.push(store)
    store.createSession({ cwd: workspace, id: sessionId, title: 't' })
    const sessionMod = await import('../../../../src/main/core/agent/session')
    spy = vi.spyOn(sessionMod, 'runAgentSession')
    // 忠实模拟 AI SDK：末条 assistant ⇒ 克隆基线 + 追加；否则从空起构（用 responseId）。
    spy.mockImplementation(
      async (_m: unknown, _o: unknown, _c: unknown, saveResponse, uiOriginalMessages, _b, responseId) => {
        const anchor = uiOriginalMessages?.at(-1)
        const isAssistant = anchor?.role === 'assistant'
        const resp: UIMessage = {
          id: isAssistant ? anchor.id : (responseId ?? 'gen'),
          role: 'assistant',
          parts: [...(isAssistant ? (anchor.parts ?? []) : []), { type: 'text', text: 'r' }]
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

  const readable = (askId: string): boolean =>
    store
      .loadMessages(sessionId)
      .some((m) => (m.parts ?? []).some((p) => (p as { toolCallId?: string }).toolCallId === askId))

  it('提问 → ask1 → 回答 → reset → ask2 → 回答 → ask3：每步 ask 均可读', async () => {
    const { runStoredAgentSession } = await import('../../../../src/main/core/agent/persist')

    // 轮1：提问 → 产出 ask1（渲染端新建，uiTargetId=undefined）
    const r1 = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      options: {}, // mock，不用真实模型
      message: { id: 'u1', role: 'user', parts: [text('问')] } as UIMessage
    })
    let heldId = r1!.uiMessageId

    // 显式把 ask1 写进行（模拟 mock 产出）——用 saveResponse 已写入的行。
    // 直接构造：轮1 的行 = r1.stored，追加 ask1（input-available）。
    const row1: UIMessage = {
      ...r1!.stored,
      parts: [...r1!.stored.parts, askPart('ask1', 'input-available')]
    }
    store.saveMessages(sessionId, [row1])
    expect(store.findAskUserContext(sessionId, 'ask1')).toBeDefined()

    // 轮2：回答 ask1（渲染端 holds heldId）⇒ 写入行1（原地），但**模型不 reset**。
    const answered1: UIMessage = {
      ...row1,
      parts: row1.parts.map((p) =>
        (p as { toolCallId?: string }).toolCallId === 'ask1'
          ? askPart('ask1', 'output-available')
          : p
      )
    }
    await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: heldId,
      options: {},
      message: answered1,
      previousStored: row1,
      answeredToolCallId: 'ask1'
    })
    heldId = store.lastMessage(sessionId)!.id

    // 轮3：reset（saveStart 把 start 推到 compaction 行；渲染端 holds heldId）
    const comp: UIMessage = {
      id: 'c1',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('问'), text('# Handoff')]
    }
    store.saveStart(sessionId, comp)
    const r3 = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: heldId,
      options: {},
      message: comp,
      previousStored: comp
    })
    // ★ 渲染端收敛到 reset 新 id（这正是修复的核心）。
    heldId = r3!.uiMessageId
    expect(store.loadMessages(sessionId).at(-1)?.id).toBe(heldId)

    // 轮4：reset 后产出 ask2（写入渲染端持有的新行）。
    const rowReset: UIMessage = {
      ...r3!.stored,
      parts: [...r3!.stored.parts, askPart('ask2', 'input-available')]
    }
    store.saveMessages(sessionId, [rowReset])
    expect(store.findAskUserContext(sessionId, 'ask2')).toBeDefined()
    // ★ 不变量：承载 ask2 的行必须可被模型读到。
    expect(readable('ask2'), '不变量破裂：ask2 的行落在 start 之前').toBe(true)

    // 轮5：回答 ask2 ⇒ 写入同一行（原地）；再产出 ask3。
    const answered2: UIMessage = {
      ...rowReset,
      parts: rowReset.parts.map((p) =>
        (p as { toolCallId?: string }).toolCallId === 'ask2'
          ? askPart('ask2', 'output-available')
          : p
      )
    }
    await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: heldId,
      options: {},
      message: answered2,
      previousStored: rowReset,
      answeredToolCallId: 'ask2'
    })
    const afterAnswer = store.lastMessage(sessionId) as UIMessage
    const withAsk3: UIMessage = {
      ...afterAnswer,
      parts: [...afterAnswer.parts, askPart('ask3', 'input-available')]
    }
    store.saveMessages(sessionId, [withAsk3])
    // ★ 不变量：承载 ask3 的行仍可被模型读到（HEAD 上此处破裂）。
    expect(readable('ask3'), '不变量破裂：ask3 的行落在 start 之前（模型读不到）').toBe(true)
  })
})
