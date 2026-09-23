import type { LanguageModelUsage, ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  contextRollover,
  contextRolloverPrompt
} from '../../../../src/main/core/agent/context-rollover'
import { estimateTokens } from '../../../../src/main/core/agent/token-estimate'

const usage = (inputTokens: number): LanguageModelUsage => ({
  inputTokens,
  outputTokens: 0,
  totalTokens: inputTokens
})

const messages: ModelMessage[] = [{ role: 'user', content: 'Work on the task.' }]

/** 造一段约 `chars` 字符的 ASCII 文本（估算式 ÷3 ⇒ 约 chars/3 token）。 */
function bigMessages(chars: number): ModelMessage[] {
  return [{ role: 'user', content: 'x'.repeat(chars) }]
}

/**
 * `prepareStep` 的入参。**上一轮实测用量**与**本次 messages**分离传入——
 * 这正是本次修复的题眼：判据应读 `messages`（本次），而非 `steps`（上一步）。
 */
function options(
  inputTokens: number | undefined,
  currentMessages = messages
): Parameters<ReturnType<typeof contextRollover>>[0] {
  return {
    steps: inputTokens === undefined ? [] : [{ usage: usage(inputTokens) }],
    messages: currentMessages
  } as Parameters<ReturnType<typeof contextRollover>>[0]
}

describe('contextRollover', () => {
  it('keeps context reset independent from visible progress', () => {
    expect(contextRolloverPrompt).toContain('Markdown handoff')
    expect(contextRolloverPrompt).not.toContain('show_progress')
    expect(contextRolloverPrompt).not.toContain('`title`')
  })

  it('does not remind below the threshold', async () => {
    // 阈值 10_000；本次输入约 600 字符（≈240 token）⇒ 不触发。
    expect(await contextRollover(10_000)(options(0, bigMessages(600)))).toBeUndefined()
  })

  it('injects a hidden user reminder at the threshold', async () => {
    // 本次输入约 40_000 字符 ⇒ ≈16_000 token ≥ 10_000 ⇒ 触发。
    const current = bigMessages(40_000)
    const result = await contextRollover(10_000)(options(0, current))

    expect(result?.messages).toEqual([
      ...current,
      { role: 'user', content: contextRolloverPrompt }
    ])
  })

  it('reminds only once within the same model context', async () => {
    const prepareStep = contextRollover(10_000)
    const first = await prepareStep(options(0, bigMessages(40_000)))

    expect(await prepareStep(options(0, first?.messages))).toBeUndefined()
  })

  it('recognizes an existing reminder represented as text content', async () => {
    const currentMessages: ModelMessage[] = [
      ...bigMessages(40_000),
      { role: 'user', content: [{ type: 'text', text: contextRolloverPrompt }] }
    ]

    expect(await contextRollover(10_000)(options(0, currentMessages))).toBeUndefined()
  })

  it('can remind again in a fresh model context', async () => {
    const prepareStep = contextRollover(10_000)
    await prepareStep(options(0, bigMessages(40_000)))

    expect(await prepareStep(options(0, bigMessages(40_000)))).toBeDefined()
  })

  // —— 本次修复的回归用例（先 Red 后 Green）——

  it('fires on the very first step when the current input alone is over the threshold (面① 首步无量)', async () => {
    // 复刻事故：`steps` 为空（step#0）、本次输入巨大（整条主链）。
    // 旧判据读 `steps.at(-1)?.usage.inputTokens ?? 0` ⇒ 0 ⇒ 永不触发。
    const result = await contextRollover(10_000)(options(undefined, bigMessages(40_000)))

    expect(result?.messages?.at(-1)).toEqual({
      role: 'user',
      content: contextRolloverPrompt
    })
  })

  it('fires based on the current input even when the previous step measured small (面② 滞后一步)', async () => {
    // 上一步只有 100 token，但本次输入暴涨越过阈值 ⇒ 必须按本次输入触发。
    const result = await contextRollover(10_000)(options(100, bigMessages(40_000)))

    expect(result?.messages?.at(-1)).toEqual({
      role: 'user',
      content: contextRolloverPrompt
    })
  })

  it('does not fire when the current input is small even if the previous step measured large', async () => {
    // 反向对照：上一步很大，但本次输入已被压小 ⇒ 不应触发（判据读的是「本次」）。
    expect(await contextRollover(10_000)(options(999_999, bigMessages(600)))).toBeUndefined()
  })
})

describe('estimateTokens', () => {
  it('returns a negligible estimate for empty messages', () => {
    expect(estimateTokens([])).toBeLessThanOrEqual(1)
  })

  it('grows monotonically with payload size', () => {
    const small = estimateTokens(bigMessages(1_000))
    const large = estimateTokens(bigMessages(100_000))

    expect(large).toBeGreaterThan(small * 50)
  })

  it('is a simple char-length / constant estimate', () => {
    // JSON 字符数 ÷ 2.5（含键名/括号等结构脚手架；2.5 经真实服务端 usage 校准，略偏大）。
    const one = estimateTokens([{ role: 'user', content: 'x'.repeat(10_000) }])
    expect(one).toBeGreaterThan(3_800)
    expect(one).toBeLessThan(4_200)
  })

  it('counts tool call inputs and results (they are part of the JSON payload)', () => {
    const toolMessages = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'c1',
            toolName: 'fs_read',
            input: { path: 'a'.repeat(5_000) }
          }
        ]
      }
    ] as unknown as ModelMessage[]

    expect(estimateTokens(toolMessages)).toBeGreaterThan(1_500)
  })

  it('is conservative: does not underestimate a large mixed payload', () => {
    // 真实事故语料约 2.6M 字符 ⇒ 服务端实测 1,047,867 token。
    // 字符式（÷2.5）应给出 ≥ 该量级的估算（偏大=更早触发，安全方向）。
    const estimate = estimateTokens([{ role: 'user', content: 'x'.repeat(2_600_000) }])
    expect(estimate).toBeGreaterThan(1_000_000)
  })

  // —— 图片（守门被图片 base64 误触发的回归）——
  //
  // 图片到 ModelMessage 实际只有 `fs_read_image` 一条路（用户附件在 `messages.ts` 被换成
  // `Attached paths:` 文本、不进模型）。判定依据是**块带 `mediaType` 字符串**。

  it('does not let an image base64 inflate the estimate', () => {
    // 一张 1.5MB PNG 的 base64 约 204 万字符；旧式会把它估成 ~77 万 token（误触发）。
    // 新式把带 mediaType 的块折叠成短占位 ⇒ 估算降到几十 token。
    const base64 = 'A'.repeat(Math.ceil(1_530_550 / 3) * 4)
    const withImage = [
      { role: 'user', content: '看这张截图' },
      {
        role: 'user',
        content: [
          { type: 'file', mediaType: 'image/png', data: `data:image/png;base64,${base64}` }
        ]
      }
    ] as unknown as ModelMessage[]

    const estimate = estimateTokens(withImage)
    expect(estimate).toBeGreaterThan(0)
    expect(estimate).toBeLessThan(100)
  })

  it('counts each image as a bounded constant, independent of byte size', () => {
    const tiny = new Uint8Array(1_000).fill(65)
    const huge = new Uint8Array(2_000_000).fill(65)
    const mk = (bytes: Uint8Array) =>
      [
        {
          role: 'user',
          content: [{ type: 'file', mediaType: 'image/png', data: { type: 'data', data: bytes } }]
        }
      ] as unknown as ModelMessage[]

    expect(estimateTokens(mk(huge)) - estimateTokens(mk(tiny))).toBe(0)
  })

  it('counts a tool-result file (the fs_read_image shape) as a bounded constant', () => {
    const messages = [
      {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: 'c1',
            toolName: 'fs_read_image',
            output: {
              type: 'content' as const,
              value: [
                {
                  type: 'file' as const,
                  mediaType: 'image/png',
                  data: { type: 'data' as const, data: new Uint8Array(300).fill(65) }
                }
              ]
            }
          }
        ]
      }
    ] as unknown as ModelMessage[]

    // 图片块被折叠成占位 ⇒ 估算极小，远小于把 300 字节当字符计。
    expect(estimateTokens(messages)).toBeLessThan(100)
  })

  it('does not misjudge a plain object that merely carries type:"file"', () => {
    // 回归：旧的结构化遍历把任何 `{type:'file'}` 当图片并跳过其内部 ⇒ 会少算大量字符。
    // 新式只认 `mediaType`，故 `{type:'file', name:<1万字符>}` 里的字符仍被计入。
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'fs_write',
            input: { path: '/a', kind: { type: 'file', name: 'x'.repeat(10_000) } }
          }
        ]
      }
    ] as unknown as ModelMessage[]

    expect(estimateTokens(messages)).toBeGreaterThan(3_000)
  })

  it('still counts ordinary text and tool payloads', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'tool-call' as const, toolCallId: 'c1', toolName: 'fs_read', input: { path: '/a' } },
          {
            type: 'tool-result' as const,
            toolCallId: 'c1',
            toolName: 'fs_read',
            output: { type: 'text' as const, value: 'y'.repeat(50_000) }
          }
        ]
      }
    ] as unknown as ModelMessage[]

    expect(estimateTokens(messages)).toBeGreaterThan(15_000)
  })
})
