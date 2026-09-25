import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'nested-cont-copy-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 守门测试：**嵌套行续写（用户在嵌套行内的 ask_user 上作答）不得把主链行复制进来**。
 *
 * 复现自真实会话 `a6159622` / dev 会话 `710fc775`：
 * - `uiTargetId` = 渲染端此刻的末端 assistant id = **主链行** id（嵌套行在 UI 上合并进主链）；
 *   故 `uiOriginalMessages.at(-1)` = 主链行 ⇒ AI SDK 以**主链行**为流式基线。
 * - `previousStored` = **嵌套行**（承载者）⇒ 落库应写回该嵌套行。
 * - 缺陷：`locateCurrentRow` 的第 1 条路径（续写）调 `storedRow` **不传 `sliceFrom`**
 *   ⇒ `parts = response.parts`（整份 = 主链行 N parts + 增量）⇒ **嵌套行 = 主链行 + 增量 = 复制**。
 * - 但**不能无差别按长度切**（M2 教训：会切掉 AI SDK 原地改写的 ask 回答，`#6843` 48→10）。
 *
 * 红线：续写后嵌套行**不得包含主链行的任何 part**，且**必须保留本轮回答（原地改写的 ask）**。
 */
describe('嵌套行续写不得复制主链行', () => {
  const cwd = workspace
  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const ask = (id: string, state: string): UIMessage['parts'][number] =>
    ({
      type: 'tool-agent_ask_user',
      toolCallId: id,
      state,
      input: { q: 1 },
      ...(state === 'output-available' ? { output: { answers: ['答'] } } : {})
    }) as never

  /** 打桩模型：产出「文本 + 一个工具调用」（模拟续写轮的新增量）。 */
  const modelTextAndTool = (id: string, name: string): MockLanguageModelV4 =>
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 't1' })
            controller.enqueue({ type: 'text-delta', id: 't1', delta: `r-${id}` })
            controller.enqueue({ type: 'text-end', id: 't1' })
            controller.enqueue({ type: 'tool-input-start', id, toolName: name })
            controller.enqueue({ type: 'tool-input-delta', id, delta: JSON.stringify({ a: 1 }) })
            controller.enqueue({ type: 'tool-input-end', id })
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
    store = new SessionStore(join(cwd, `d-${Math.random().toString(36).slice(2)}.db`))
    openStores.push(store)
    store.createSession({ cwd, id: 's', title: 'p' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  const nestedRows = (): UIMessage[] =>
    store
      .loadVisibleMessages('s')
      .filter((m) => m.role === 'assistant' && (m.metadata as { nested?: boolean })?.nested === true)

  it('主链行为基线（uiTargetId=主链id）时，嵌套续写行不得含主链 parts，且保留本轮回答', async () => {
    const MAIN = 'main-chain'
    const NEST = 'main-chain-nested-aaaa'
    // 主链行：含 ask_user（已答）。
    store.saveMessages('s', [
      {
        id: MAIN,
        role: 'assistant',
        parts: [text('MAIN-A'), text('MAIN-B'), ask('call-main-ask', 'output-available')]
      } as UIMessage
    ])
    // 嵌套行（承载者）：停在等待回答的 ask（input-available）。这是本轮要续写的行。
    store.saveMessages('s', [
      {
        id: NEST,
        role: 'assistant',
        metadata: { nested: true } as never,
        parts: [text('NEST-1'), text('NEST-2'), ask('call-nest-ask', 'input-available')]
      } as UIMessage
    ])

    const carrier = store.findMessageById('s', NEST)!
    // 渲染端送来的续写快照（assistant）：其 id 是主链 id（UI 上合并），parts 是主链合并视图 + 已答的嵌套 ask。
    const rendererSnapshot: UIMessage = {
      id: MAIN,
      role: 'assistant',
      parts: [
        text('MAIN-A'),
        text('MAIN-B'),
        ask('call-main-ask', 'output-available'),
        ask('call-nest-ask', 'output-available')
      ]
    } as UIMessage

    await runStoredAgentSession(store, {
      sessionId: 's',
      cwd,
      options: { model: modelTextAndTool('t-new', 'fs_new') } as never,
      nested: true,
      message: rendererSnapshot,
      previousStored: carrier,
      continuationPrompt: { id: 'crit', role: 'user', parts: [text('判据')] } as UIMessage,
      answeredToolCallId: 'call-nest-ask',
      uiTargetId: MAIN
    })

    // 续写应写回原嵌套行（原地替换，不新增）。
    const rows = nestedRows()
    expect(rows).toHaveLength(1)
    const stored = rows[0]
    expect(stored.id).toBe(NEST)
    const serialized = JSON.stringify(stored.parts)
    // ① 不得含主链行内容（复制 = 缺陷）。
    expect(serialized).not.toContain('MAIN-A')
    expect(serialized).not.toContain('MAIN-B')
    expect(serialized).not.toContain('call-main-ask')
    // ② 必须保留承载行自身内容 + 本轮新增。
    expect(serialized).toContain('NEST-1')
    expect(serialized).toContain('NEST-2')
    expect(serialized).toContain('t-new')
    // ③ 本轮回答必须落回（ask 变 output-available）。
    const nestAsk = (stored.parts ?? []).find(
      (p) => (p as { toolCallId?: string }).toolCallId === 'call-nest-ask'
    ) as { state?: string } | undefined
    expect(nestAsk?.state).toBe('output-available')
  })

  it('回退路径（无 uiTargetId，基线=承载行）：仍不得复制主链，且保留回答', async () => {
    const MAIN = 'main-chain'
    const NEST = 'main-chain-nested-bbbb'
    store.saveMessages('s', [
      { id: MAIN, role: 'assistant', parts: [text('MAIN-A'), text('MAIN-B')] } as UIMessage
    ])
    store.saveMessages('s', [
      {
        id: NEST,
        role: 'assistant',
        metadata: { nested: true } as never,
        parts: [text('NEST-1'), ask('call-nest-ask', 'input-available')]
      } as UIMessage
    ])
    const carrier = store.findMessageById('s', NEST)!
    const rendererSnapshot: UIMessage = {
      id: MAIN,
      role: 'assistant',
      parts: [text('MAIN-A'), text('MAIN-B'), ask('call-nest-ask', 'output-available')]
    } as UIMessage

    await runStoredAgentSession(store, {
      sessionId: 's',
      cwd,
      options: { model: modelTextAndTool('t-new', 'fs_new') } as never,
      nested: true,
      message: rendererSnapshot,
      previousStored: carrier,
      answeredToolCallId: 'call-nest-ask'
      // 注意：**不传** uiTargetId ⇒ uiOriginalMessages = [carrier]（基线即承载行）。
    })

    const stored = nestedRows().find((r) => r.id === NEST)!
    const serialized = JSON.stringify(stored.parts)
    expect(serialized).not.toContain('MAIN-A')
    expect(serialized).not.toContain('MAIN-B')
    expect(serialized).toContain('NEST-1')
    expect(serialized).toContain('t-new')
    const nestAsk = (stored.parts ?? []).find(
      (p) => (p as { toolCallId?: string }).toolCallId === 'call-nest-ask'
    ) as { state?: string } | undefined
    expect(nestAsk?.state).toBe('output-available')
  })
})
