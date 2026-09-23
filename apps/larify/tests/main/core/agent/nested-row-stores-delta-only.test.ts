import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'nested-delta-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 守门测试：**新建嵌套行只存本轮增量**，不得复制基线（上一轮嵌套行）的 parts。
 *
 * 背景：AI SDK 会把渲染层末端 assistant（= 上一轮嵌套行）克隆为流式基线、只追加增量 ⇒ 本轮
 * 「模型输出」= 基线全部 parts + 本轮新增。旧实现整份落库 ⇒ 子任务链每轮复制一份历史，
 * 行体积单调膨胀（真实会话 `825617b9` 12 轮 38K→333K tokens）。修复后只落 `slice(基线长度)`。
 *
 * 红线（不可回归）：切片**仅用于新建嵌套轮**（纯追加）。**续写路径不切片**——否则会吞掉
 * AI SDK 原地改写的 `ask_user` 回答（见 `nested-continuation-keeps-ask-user`）。
 */
describe('新建嵌套行只存增量', () => {
  const cwd = workspace
  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const askPending = (id: string): UIMessage['parts'][number] =>
    ({
      type: 'tool-agent_ask_user',
      toolCallId: id,
      state: 'input-available',
      input: { q: 1 }
    }) as never

  /** 打桩模型：一个 run 内产出「文本 + 一个工具调用」。 */
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

  const nestedAssistantRows = (): UIMessage[] =>
    store
      .loadVisibleMessages('s')
      .filter((m) => m.role === 'assistant' && (m.metadata as { nested?: boolean })?.nested === true)

  it('含基线的上一轮嵌套行存在时，新一轮只落本轮增量（不含基线 parts）', async () => {
    store.saveMessages('s', [{ id: 'main', role: 'assistant', parts: [text('MAIN')] } as UIMessage])
    // 上一轮嵌套行（含旧 ask）作为基线：其 parts 不得出现在本轮新行里。
    store.saveMessages('s', [
      {
        id: 'main-nested-prev',
        role: 'assistant',
        metadata: { nested: true } as never,
        parts: [text('PREV'), askPending('old-ask')]
      } as UIMessage
    ])

    await runStoredAgentSession(store, {
      sessionId: 's',
      cwd,
      options: { model: modelTextAndTool('t0', 'fs_0') } as never,
      nested: true,
      message: {
        id: 'crit-0',
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [text('判据')]
      } as UIMessage
    })

    const newest = nestedAssistantRows().at(-1)!
    const types = (newest.parts ?? []).map((p) => (p as { type: string }).type)
    // 只含本轮增量：step-start + text + tool（不含基准线的 text('PREV') / old-ask）。
    expect(types).toEqual(['step-start', 'text', 'tool-fs_0'])
    expect(JSON.stringify(newest.parts)).not.toContain('PREV')
    expect(JSON.stringify(newest.parts)).not.toContain('old-ask')
  })

  it('连续三轮：每行只含本轮增量，行体积不随轮次线性膨胀', async () => {
    store.saveMessages('s', [{ id: 'main', role: 'assistant', parts: [text('MAIN')] } as UIMessage])

    const lengths: number[] = []
    for (let r = 0; r < 3; r++) {
      await runStoredAgentSession(store, {
        sessionId: 's',
        cwd,
        options: { model: modelTextAndTool(`t${r}`, `fs_${r}`) } as never,
        nested: true,
        message: {
          id: `crit-${r}`,
          role: 'user',
          metadata: { nested: true, compaction: true },
          parts: [text(`判据${r}`)]
        } as UIMessage
      })
      const row = nestedAssistantRows().at(-1)!
      lengths.push((row.parts ?? []).length)
      // 每轮都只含本轮增量（3 parts），**不**累积历史。
      expect((row.parts ?? []).length).toBe(3)
    }
    // 修复前：3 → 6 → 9（逐轮 +3 且含全部历史）；修复后恒为 3。
    expect(lengths).toEqual([3, 3, 3])
  })
})
