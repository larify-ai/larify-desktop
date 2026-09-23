import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'dirty-matrix-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 守门测试：**承载行可能含各种「未完成/遗留」的 part，喂回历史时绝不能中断流**。
 *
 * 背景：本修复把「承载行运行记录」喂回模型输入（见
 * `memory/larify-desktop/nested-continuation-reads-own-run-design.md`）。这让**历史里任何
 * 非法/未完成状态**都进入 prompt ⇒ 只要出现「有 `tool-call` 却无 `tool-result`」，AI SDK 就报
 * `Tool result(s) missing for tool call(s) …` 并**中断整个流**。
 *
 * 真实来源：旧缺陷 `nested-ask-user-answer-not-landed` 会在同一行堆积多个 `input-available`
 * 的 `ask_user`（真实 `da3ad8bb#6921` 有 8 个）；此外任何工具都可能停在 `input-available`。
 *
 * 不变量：模型输入里两集合相等（`tool-call` id 集合 == `tool-result` id 集合），且无 error chunk。
 */
describe('嵌套续写脏数据矩阵：喂回承载行历史不得中断流', () => {
  let store: SessionStore
  const sessionId = 's-dirty-matrix'
  const cwd = workspace

  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const stepStart = (): UIMessage['parts'][number] => ({ type: 'step-start' })
  const tool = (id: string, state = 'output-available'): UIMessage['parts'][number] =>
    ({ type: 'tool-fs_read', toolCallId: id, state, input: {}, output: { ok: 1 } }) as never
  const ask = (id: string, state: string, extra: Record<string, unknown> = {}): UIMessage['parts'][number] =>
    ({ type: 'tool-agent_ask_user', toolCallId: id, state, input: { message: `Q-${id}` }, ...extra }) as never

  const openStores: SessionStore[] = []
  beforeEach(() => {
    store = new SessionStore(join(workspace, `dm-${Math.random().toString(36).slice(2)}.db`))
    openStores.push(store)
    store.createSession({ cwd, id: sessionId, title: 'dirty-matrix' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  const runWith = async (carriedParts: UIMessage['parts']) => {
    store.saveMessages(sessionId, [
      { id: 'main-anchor', role: 'assistant', parts: [text('主链')] } as UIMessage,
      {
        id: 'main-anchor-nested-A',
        role: 'assistant',
        metadata: { nested: true },
        parts: carriedParts
      } as UIMessage
    ])
    const nestedRow = store.loadVisibleMessages(sessionId).find((m) => m.id === 'main-anchor-nested-A')!
    const nestPrompt: UIMessage = {
      id: 'p',
      role: 'user',
      metadata: { nested: true, compaction: true },
      parts: [text('判据')]
    }
    store.saveMessages(sessionId, [nestPrompt])

    const captured: unknown[][] = []
    const errors: string[] = []
    const model = new MockLanguageModelV4({
      doStream: async (options: { prompt: unknown[] }) => {
        captured.push(options.prompt)
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] })
              c.enqueue({ type: 'text-start', id: 't1' })
              c.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' })
              c.enqueue({ type: 'text-end', id: 't1' })
              c.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
              })
              c.close()
            }
          })
        }
      }
    })

    let threw: string | undefined
    try {
      await runStoredAgentSession(store, {
        sessionId,
        cwd,
        options: { model } as never,
        nested: true,
        previousStored: nestedRow,
        continuationPrompt: nestPrompt,
        answeredToolCallId: 'cur',
        message: {
          id: 'main-anchor',
          role: 'assistant',
          parts: [text('主链'), ask('cur', 'output-available', { output: { answers: ['答'] } })]
        } as UIMessage,
        onChunk: (chunk) => {
          if ((chunk as { type?: string }).type === 'error') errors.push(String(chunk))
        }
      })
    } catch (e) {
      threw = (e as Error).message
    }

    const prompt = (captured[0] ?? []) as Array<{ role: string; content: unknown[] }>
    const calls: string[] = []
    const results: string[] = []
    for (const m of prompt) {
      for (const part of m.content as Array<Record<string, unknown>>) {
        if (part.type === 'tool-call') calls.push(String(part.toolCallId))
        if (part.type === 'tool-result') results.push(String(part.toolCallId))
      }
    }
    return { threw, errors, calls, results }
  }

  const cases: Array<[string, UIMessage['parts']]> = [
    ['正常：历史工具 + 等待 ask', [stepStart(), tool('t1'), stepStart(), text('结论'), ask('cur', 'input-available')]],
    ['多个遗留等待 ask', [stepStart(), ask('s1', 'input-available'), stepStart(), ask('s2', 'input-available'), ask('cur', 'input-available')]],
    ['ask 停在 input-streaming', [stepStart(), ask('cur', 'input-streaming')]],
    ['ask 带 output-error', [stepStart(), ask('x1', 'output-error'), ask('cur', 'input-available')]],
    ['ask 带 output-denied', [stepStart(), ask('x2', 'output-denied'), ask('cur', 'input-available')]],
    ['普通工具停在 input-available', [stepStart(), tool('t9', 'input-available'), ask('cur', 'input-available')]],
    ['普通工具停在 input-streaming', [stepStart(), tool('t8', 'input-streaming'), ask('cur', 'input-available')]],
    ['没有 step-start', [text('无分步'), ask('cur', 'input-available')]],
    ['只有等待 ask', [ask('cur', 'input-available')]],
    ['空 parts', []]
  ]

  for (const [name, parts] of cases) {
    it(`${name} ⇒ 无 error chunk、call/result 集合相等`, async () => {
      const r = await runWith(parts)
      expect(r.threw, '不得抛错').toBeUndefined()
      expect(r.errors, '不得有 error chunk（流被中断）').toHaveLength(0)
      expect([...r.calls].sort(), 'tool-call 与 tool-result 必须一一配对').toEqual([...r.results].sort())
    })
  }
})
