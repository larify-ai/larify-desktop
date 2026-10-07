import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'reset-fullround-'))
afterAll(() => {
  try {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    /* Windows 下 DB 句柄可能仍占用 */
  }
})

import { SessionStore } from '../../../../src/main/core/session/store'

const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })

/** 产出 n 段文本的 mock 模型（真实 AI SDK 会额外产 1 个 `step-start`）。 */
const streamOf = (n: number): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          for (let i = 0; i < n; i++) {
            controller.enqueue({ type: 'text-start', id: `t${i}` })
            controller.enqueue({ type: 'text-delta', id: `t${i}`, delta: `内容${i}` })
            controller.enqueue({ type: 'text-end', id: `t${i}` })
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

describe('探针：reset 轮落库不得误切本段产出（真实 AI SDK）', () => {
  const sessionId = 's-slice'
  let store: SessionStore
  const open: SessionStore[] = []

  beforeEach(() => {
    store = new SessionStore(join(workspace, `m-${Math.random().toString(36).slice(2)}.db`))
    open.push(store)
    store.createSession({ cwd: workspace, id: sessionId, title: 't' })
  })
  afterEach(() => {
    for (const s of open.splice(0)) s.dispose()
  })

  it('reset 前有主链 assistant（标准路径）⇒ 新行 = 本段产出（unchanged），不含旧内容', async () => {
    const { runStoredAgentSession } = await import('../../../../src/main/core/agent/persist')
    store.saveMessages(sessionId, [
      {
        id: 'G',
        role: 'assistant',
        metadata: { totalProcessingMs: 5000 },
        parts: [text('旧A'), text('旧B'), text('旧C')]
      }
    ])
    const comp: UIMessage = {
      id: 'c1',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('问'), text('# Handoff')]
    }
    store.saveStart(sessionId, comp)
    const r = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: 'G',
      options: { model: streamOf(3) } as never,
      message: comp,
      previousStored: comp
    })
    // 本段产出 = step-start + 3 段文本 = 4 parts；不得被切、也不得含旧 A/B/C。
    expect(r?.stored.parts.length).toBe(4)
    const s = JSON.stringify(r?.stored.parts)
    expect(s).toContain('内容0')
    expect(s).not.toContain('旧A')
  })

  it('reset 前无主链 assistant（continuationOf 为空）⇒ 新行 = 本段产出（不得为空）', async () => {
    const { runStoredAgentSession } = await import('../../../../src/main/core/agent/persist')
    const comp: UIMessage = {
      id: 'c2',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('问'), text('# Handoff')]
    }
    store.saveStart(sessionId, comp)
    const r = await runStoredAgentSession(store, {
      sessionId,
      cwd: workspace,
      uiTargetId: 'held',
      options: { model: streamOf(1) } as never,
      message: comp,
      previousStored: comp
    })
    expect(r?.stored.parts.length).toBe(2) // step-start + 1 段
    expect(JSON.stringify(r?.stored.parts)).toContain('内容0')
  })
})
