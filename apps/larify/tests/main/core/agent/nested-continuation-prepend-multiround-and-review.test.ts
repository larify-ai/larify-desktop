import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'nested-prepend-mr-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 影响面核实（补测，配对 `nested-continuation-does-not-copy-main-chain`）：
 *
 * - **多轮**：同一嵌套行被连续续写多次（每次都带 `uiTargetId`=主链 id ⇒ 走 `prepend` 重建路径），
 *   断言每轮都恰好 = 承载行自身内容 + 本轮新增，**不复制主链、不丢历史、不双计**。
 * - **reviewRow**：续写嵌套行时变更卡片应挂在**主链行**（无 nested 标记），且 `prepend` 不得改变
 *   这一语义。
 */
describe('嵌套续写 prepend：多轮累积 + 卡片回流主链', () => {
  const cwd = workspace
  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const ask = (id: string, state: string): UIMessage['parts'][number] =>
    ({
      type: 'tool-agent_ask_user',
      toolCallId: id,
      state,
      input: { q: id },
      ...(state === 'output-available' ? { output: { answers: ['答'] } } : {})
    }) as never

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
    store = new SessionStore(join(cwd, `p-${Math.random().toString(36).slice(2)}.db`))
    openStores.push(store)
    store.createSession({ cwd, id: 's', title: 'p' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  const rowById = (id: string): UIMessage | undefined =>
    store.loadVisibleMessages('s').find((m) => m.id === id)
  const textsOf = (m: UIMessage | undefined): string[] =>
    (m?.parts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)

  it('同一嵌套行连续续写 3 轮：每轮仅得「承载行 + 本轮新增」，不复制主链', async () => {
    const MAIN = 'main-chain'
    const NEST = 'main-chain-nested-aaaa'
    store.saveMessages('s', [
      {
        id: MAIN,
        role: 'assistant',
        parts: [text('MAIN-A'), text('MAIN-B'), ask('call-main-ask', 'output-available')]
      } as UIMessage
    ])
    // 承载嵌套行：停在等待回答的 ask（input-available）。
    store.saveMessages('s', [
      {
        id: NEST,
        role: 'assistant',
        metadata: { nested: true } as never,
        parts: [text('NEST-BASE'), ask('call-nest-ask-0', 'input-available')]
      } as UIMessage
    ])

    const rounds = 3
    for (let r = 0; r < rounds; r += 1) {
      const carrier = store.findMessageById('s', NEST)!
      // 渲染层快照：id = 主链 id（UI 合并视图），含主链全量 + 已答的嵌套 ask。
      const snapshot: UIMessage = {
        id: MAIN,
        role: 'assistant',
        parts: [
          text('MAIN-A'),
          text('MAIN-B'),
          ask('call-main-ask', 'output-available'),
          ask(`call-nest-ask-${r}`, 'output-available')
        ]
      } as UIMessage

      await runStoredAgentSession(store, {
        sessionId: 's',
        cwd,
        options: { model: modelTextAndTool(`t-new-${r}`, 'fs_new') } as never,
        nested: true,
        message: snapshot,
        previousStored: carrier,
        continuationPrompt: { id: 'crit', role: 'user', parts: [text(`判据-${r}`)] } as UIMessage,
        answeredToolCallId: `call-nest-ask-${r}`,
        uiTargetId: MAIN
      })

      // 每轮结束后：把承载行末尾补一个等待回答的 ask，模拟模型再问一次。
      if (r < rounds - 1) {
        const after = rowById(NEST)!
        store.saveMessages('s', [
          { ...after, parts: [...(after.parts ?? []), ask(`call-nest-ask-${r + 1}`, 'input-available')] }
        ])
      }
    }

    const final = rowById(NEST)!
    const serialized = JSON.stringify(final.parts)
    // ① 全程不得出现主链内容。
    expect(serialized).not.toContain('MAIN-A')
    expect(serialized).not.toContain('MAIN-B')
    expect(serialized).not.toContain('call-main-ask')
    // ② 历史必须累积且不重复：基底 + 每轮新增各一次。
    const texts = textsOf(final)
    expect(texts.filter((t) => t === 'NEST-BASE')).toHaveLength(1)
    for (let r = 0; r < rounds; r += 1) {
      expect(texts.filter((t) => t === `r-t-new-${r}`), `第 ${r} 轮新增应恰出现一次`).toHaveLength(1)
    }
    // ③ 每轮回答都落回（无恒停 input-available）。
    const states = (final.parts ?? [])
      .filter((p) => (p as { type: string }).type === 'tool-agent_ask_user')
      .map(
        (p) =>
          `${(p as { toolCallId: string }).toolCallId}:${(p as { state: string }).state}`
      )
    for (let r = 0; r < rounds; r += 1) {
      expect(states).toContain(`call-nest-ask-${r}:output-available`)
    }
  })

  it('reviewRow：嵌套续写时卡片目标行 = 主链行（无 nested），内容仍为主链基线', async () => {
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
        parts: [text('NEST-BASE'), ask('call-nest-ask', 'input-available')]
      } as UIMessage
    ])
    const carrier = store.findMessageById('s', NEST)!
    const snapshot: UIMessage = {
      id: MAIN,
      role: 'assistant',
      parts: [text('MAIN-A'), text('MAIN-B'), ask('call-nest-ask', 'output-available')]
    } as UIMessage

    const result = await runStoredAgentSession(store, {
      sessionId: 's',
      cwd,
      options: { model: modelTextAndTool('t-new', 'fs_new') } as never,
      nested: true,
      message: snapshot,
      previousStored: carrier,
      answeredToolCallId: 'call-nest-ask',
      uiTargetId: MAIN
    })

    expect(result).toBeDefined()
    // 卡片挂主链行 id，且内容基线为**主链行本身**（无 nested、无嵌套私货）。
    expect(result!.reviewRowId).toBe(MAIN)
    expect((result!.reviewRow.metadata as { nested?: boolean } | undefined)?.nested).not.toBe(true)
    const reviewTexts = textsOf(result!.reviewRow)
    expect(reviewTexts).toContain('MAIN-A')
    expect(reviewTexts).not.toContain('NEST-BASE')
    // 落库行（嵌套行）才是重建后的内容。
    expect(textsOf(result!.stored)).not.toContain('MAIN-A')
    expect(textsOf(result!.stored)).toContain('NEST-BASE')
  })
})
