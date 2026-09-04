import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4FinishReason } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runAgent } from '../../../../src/main/core/agent/engine'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

const finishReason = (
  unified: LanguageModelV4FinishReason['unified']
): LanguageModelV4FinishReason => ({ unified, raw: undefined })

function model(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: 'hello' },
        { type: 'text-end', id: 'text' },
        { type: 'finish', finishReason: finishReason('stop'), usage }
      ])
    })
  })
}

describe('runAgent', () => {
  it('returns the AI SDK stream and forwards execution options', async () => {
    const languageModel = model()
    const controller = new AbortController()
    const prepareStep = vi.fn()
    const providerOptions = { test: { mode: 'test' } }

    const stream = runAgent([{ role: 'user', content: 'hello' }], {
      model: languageModel,
      tools: {},
      activeTools: [],
      toolsContext: {},
      imageCapable: false,
      abortSignal: controller.signal,
      system: 'system prompt',
      providerOptions,
      prepareStep
    })

    const parts = []
    for await (const part of stream) parts.push(part)

    expect(parts.some(({ type }) => type === 'text-delta')).toBe(true)
    expect(languageModel.doStreamCalls[0]).toMatchObject({
      abortSignal: controller.signal,
      providerOptions
    })
    expect(JSON.stringify(languageModel.doStreamCalls[0].prompt)).toContain('system prompt')
    expect(JSON.stringify(languageModel.doStreamCalls[0].prompt)).toContain('hello')
    expect(prepareStep).toHaveBeenCalledOnce()
  })

  it('retries a mid-stream network error before any content', async () => {
    const networkError = Object.assign(new TypeError('terminated'), {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    })
    const doStream = vi
      .fn()
      .mockResolvedValueOnce({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 'text' })
            controller.error(networkError)
          }
        })
      })
      .mockResolvedValueOnce({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text' },
          { type: 'text-delta', id: 'text', delta: 'hello' },
          { type: 'text-end', id: 'text' },
          { type: 'finish', finishReason: finishReason('stop'), usage }
        ])
      })
    const languageModel = new MockLanguageModelV4({ doStream })
    const stream = runAgent([{ role: 'user', content: 'hello' }], {
      model: languageModel,
      tools: {},
      activeTools: [],
      toolsContext: {},
      imageCapable: false
    })

    const parts = []
    for await (const part of stream) parts.push(part)

    expect(parts.some(({ type }) => type === 'text-delta')).toBe(true)
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the caller aborts', async () => {
    const abortError = new DOMException('Aborted', 'AbortError')
    const doStream = vi
      .fn()
      .mockResolvedValueOnce({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.error(abortError)
          }
        })
      })
      .mockResolvedValueOnce({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-delta', id: 'text', delta: 'hello' },
          { type: 'finish', finishReason: finishReason('stop'), usage }
        ])
      })
    const languageModel = new MockLanguageModelV4({ doStream })
    const stream = runAgent([{ role: 'user', content: 'hello' }], {
      model: languageModel,
      tools: {},
      activeTools: [],
      toolsContext: {},
      imageCapable: false
    })

    const parts = []
    for await (const part of stream) parts.push(part)

    expect(parts.some(({ type }) => type === 'error')).toBe(true)
    expect(doStream).toHaveBeenCalledTimes(1)
  })

  it('sends only active tools to the model', async () => {
    const languageModel = model()
    const tool = { description: 'test', inputSchema: z.object({}) }
    const stream = runAgent([{ role: 'user', content: 'hello' }], {
      model: languageModel,
      tools: { visible: tool, hidden: tool },
      activeTools: ['visible'],
      toolsContext: {},
      imageCapable: false
    })

    for await (const _ of stream) void _

    expect(languageModel.doStreamCalls[0].tools?.map(({ name }) => name)).toEqual(['visible'])
  })

  it('recovers a mid-stream network error after content has streamed (streamRetries)', async () => {
    // 模拟 terminated：首次调用已流出部分内容（text-delta），随后流被中断（terminated）。
    // 内容已流出 → ai-retry 不再重试，但 streamText 的 streamRetries/onError 应捕获该
    // 错误并重跑当前 step（第二次调用成功恢复）。
    const networkError = Object.assign(new TypeError('terminated'), {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    })
    const doStream = vi
      .fn()
      .mockResolvedValueOnce({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 'text' })
            controller.enqueue({ type: 'text-delta', id: 'text', delta: 'partial' })
            controller.error(networkError)
          }
        })
      })
      .mockResolvedValueOnce({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text' },
          { type: 'text-delta', id: 'text', delta: 'hello' },
          { type: 'text-end', id: 'text' },
          { type: 'finish', finishReason: finishReason('stop'), usage }
        ])
      })
    const languageModel = new MockLanguageModelV4({ doStream })
    const stream = runAgent([{ role: 'user', content: 'hello' }], {
      model: languageModel,
      tools: {},
      activeTools: [],
      toolsContext: {},
      imageCapable: false
    })

    const parts = []
    for await (const part of stream) parts.push(part)

    // 流级恢复后应成功产出最终文本，且底层 model 被调用 2 次（重跑了一次失败的 step）。
    expect(parts.some(({ type, text }) => type === 'text-delta' && text === 'hello')).toBe(true)
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it('retries a silent truncation (finishReason=error) before content via ai-retry result layer', async () => {
    // 模拟模型正常返回但 finishReason 为 'error'（静默断流），且内容未流出。
    // 这应触发 ai-retry 的"结果层"finishReason('error') 重试——这是 ai-retry 独立
    // 于 streamRetries 的能力（streamRetries 处理的是被传播的错误，而非 finish reason）。
    // 验证 doStream 被重试 2 次。
    const doStream = vi
      .fn()
      .mockResolvedValueOnce({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'finish', finishReason: finishReason('error'), usage }
        ])
      })
      .mockResolvedValueOnce({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text' },
          { type: 'text-delta', id: 'text', delta: 'hello' },
          { type: 'text-end', id: 'text' },
          { type: 'finish', finishReason: finishReason('stop'), usage }
        ])
      })
    const languageModel = new MockLanguageModelV4({ doStream })
    const stream = runAgent([{ role: 'user', content: 'hello' }], {
      model: languageModel,
      tools: {},
      activeTools: [],
      toolsContext: {},
      imageCapable: false
    })

    const parts = []
    for await (const part of stream) parts.push(part)

    // 结果层重试后应产出最终文本，且 model 被调用 2 次。
    expect(parts.some(({ type, text }) => type === 'text-delta' && text === 'hello')).toBe(true)
    expect(doStream).toHaveBeenCalledTimes(2)
  })
})
