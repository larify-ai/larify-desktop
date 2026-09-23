import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { stripUnfinishedTools } from '../../../../src/main/core/agent/persist'

/**
 * `stripUnfinishedTools` 的单元测试（纯函数，不依赖 DB / 模型）。
 *
 * 语义：承载行里**所有「未完成（`input-available`）的工具 part」都要去掉** ——
 * ① 本轮的 `ask_user` 由回答 part 顶替（回答自带 `input`(问题)+`output`(回答)）；
 * ② 遗留/未完成的 part 若留下，会变成「有 tool-call 却无 tool-result」⇒
 *    AI SDK 报 `Tool result(s) missing for tool call(s) …` 并**中断整个流**。
 *
 * 已终态（`output-available` / `output-error` / `output-denied`）照常保留。
 */
describe('stripUnfinishedTools：去掉未完成的工具 part', () => {
  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const stepStart = (): UIMessage['parts'][number] => ({ type: 'step-start' })
  const toolPart = (id: string, state: string): UIMessage['parts'][number] =>
    ({ type: 'tool-fs_read', toolCallId: id, state, input: {}, output: {} }) as never
  const askPart = (
    id: string,
    state: string,
    extra: Record<string, unknown> = {}
  ): UIMessage['parts'][number] =>
    ({ type: 'tool-agent_ask_user', toolCallId: id, state, input: { message: 'q' }, ...extra }) as never

  it('去掉全部 input-available（ask 与普通工具都算）；已终态保留；非工具 part 不动', () => {
    const parts = [
      stepStart(),
      askPart('h1', 'output-available', { output: { answers: ['历史的答'] } }),
      toolPart('t1', 'output-available'),
      stepStart(),
      text('中间结论'),
      askPart('cur', 'input-available'),
      askPart('stale', 'input-available'),
      toolPart('t9', 'input-available')
    ]
    const out = stripUnfinishedTools(parts)

    expect(out.some((p) => (p as { state?: string }).state === 'input-available')).toBe(false)
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 'h1')).toBe(true)
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 't1')).toBe(true)
    expect(out).toContainEqual(text('中间结论'))
    expect(out).toContainEqual(stepStart())
  })

  it('output-error / output-denied 属已终态，保留', () => {
    const parts = [stepStart(), askPart('e1', 'output-error'), toolPart('e2', 'output-error'), askPart('d1', 'output-denied')]
    const out = stripUnfinishedTools(parts)
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 'e1')).toBe(true)
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 'e2')).toBe(true)
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 'd1')).toBe(true)
  })

  it('无等待态时原样返回；空数组亦同', () => {
    const parts = [stepStart(), toolPart('t1', 'output-available'), text('x')]
    expect(stripUnfinishedTools(parts)).toEqual(parts)
    expect(stripUnfinishedTools([])).toEqual([])
  })

  it('input-streaming **不去**（尚未发出 tool-call ⇒ 不会造成缺配对；实测喂回也安全）', () => {
    // 只有 `input-available`（= 已发出 tool-call、但还没 result）才会触发 AI SDK 的
    // `Tool result(s) missing …`。`input-streaming` 阶段还没有 tool-call 产出，
    // 由脏数据矩阵实测确认安全（见 `nested-continuation-dirty-data.test.ts`）。
    const parts = [stepStart(), askPart('s', 'input-streaming'), toolPart('t', 'input-streaming')]
    const out = stripUnfinishedTools(parts)
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 's')).toBe(true)
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 't')).toBe(true)
  })
})
