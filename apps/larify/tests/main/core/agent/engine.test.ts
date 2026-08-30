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
})
