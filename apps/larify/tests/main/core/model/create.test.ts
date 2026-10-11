import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'

const deepseek = vi.hoisted(() => ({
  createDeepSeek: vi.fn()
}))

const modelApi = vi.hoisted(() => ({
  getModelApiService: vi.fn()
}))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: deepseek.createDeepSeek
}))

vi.mock('../../../../src/main/model-api/service', () => ({
  getModelApiService: modelApi.getModelApiService
}))

import { createModelRuntime, wellFormValue } from '../../../../src/main/core/model/create'
import { officialModelBaseUrl } from '../../../../src/main/core/model/config'

const CREDENTIALS = { baseUrl: 'https://api.larify.ai', apiKey: 'sk-test-key' }

beforeEach(() => {
  deepseek.createDeepSeek.mockReset()
  deepseek.createDeepSeek.mockReturnValue((modelId: string) => ({ modelId }))
  modelApi.getModelApiService.mockReset()
  modelApi.getModelApiService.mockReturnValue({
    getCachedCredentialsSync: () => CREDENTIALS
  })
})

describe('createModelRuntime', () => {
  it('throws when credentials are not ready', () => {
    modelApi.getModelApiService.mockReturnValue({
      getCachedCredentialsSync: () => null
    })
    expect(() => createModelRuntime({ modelId: 'deepseek-flash', reasoningEffort: 'off' })).toThrow(
      '模型凭据未就绪'
    )
  })

  it('points the DeepSeek client at the gateway with the user token', () => {
    createModelRuntime({ modelId: 'deepseek-flash', reasoningEffort: 'off' })
    expect(deepseek.createDeepSeek).toHaveBeenCalledWith({
      baseURL: 'https://api.larify.ai/v1',
      apiKey: 'sk-test-key'
    })
  })

  it('uses the configured model id', () => {
    const runtime = createModelRuntime({ modelId: 'deepseek-v4-pro', reasoningEffort: 'off' })
    expect(runtime.model.modelId).toBe('deepseek-v4-pro')
  })

  it('maps reasoningEffort off to thinking:disabled (no reasoning_effort sent)', () => {
    const runtime = createModelRuntime({ modelId: 'deepseek-flash', reasoningEffort: 'off' })
    expect(runtime.providerOptions).toEqual({
      deepseek: { thinking: { type: 'disabled' } }
    })
  })

  it('maps reasoningEffort high to thinking:enabled + reasoningEffort high', () => {
    const runtime = createModelRuntime({ modelId: 'deepseek-flash', reasoningEffort: 'high' })
    expect(runtime.providerOptions).toEqual({
      deepseek: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'high'
      }
    })
  })

  it('passes reasoningEffort max through unchanged (DeepSeek supports max)', () => {
    const runtime = createModelRuntime({ modelId: 'deepseek-v4-pro', reasoningEffort: 'max' })
    expect(runtime.providerOptions).toEqual({
      deepseek: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'max'
      }
    })
  })

  it('defaults to the default config when called without arguments', () => {
    const runtime = createModelRuntime()
    expect(runtime.model.modelId).toBe('deepseek-flash')
    expect(runtime.providerOptions).toEqual({
      deepseek: { thinking: { type: 'disabled' } }
    })
  })

  it('routes to DeepSeek official (trimmed key) when an own API key is present', () => {
    // 走官方直连时不应当读取网关凭据。
    modelApi.getModelApiService.mockReturnValue({
      getCachedCredentialsSync: () => {
        throw new Error('must not be called')
      }
    })
    createModelRuntime({
      modelId: 'deepseek-flash',
      reasoningEffort: 'high',
      apiKey: '  sk-own  '
    })
    expect(deepseek.createDeepSeek).toHaveBeenCalledWith({
      baseURL: officialModelBaseUrl,
      apiKey: 'sk-own'
    })
  })

  it('applies the same reasoning options when using the official API', () => {
    const runtime = createModelRuntime({
      modelId: 'deepseek-flash',
      reasoningEffort: 'max',
      apiKey: 'sk-own'
    })
    expect(runtime.model.modelId).toBe('deepseek-flash')
    expect(runtime.providerOptions).toEqual({
      deepseek: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'max'
      }
    })
  })

  it('well-forms lone surrogates so the request body stays encodable', () => {
    const cut = 'C = \uD835\uDC63 + \uD835' // 截断留下的半个字符（孤立高代理）
    const fixed = wellFormValue({ t: cut }).t
    expect(JSON.stringify({ t: cut })).toContain('\\ud835') // 未处理时确实非法
    expect(fixed).toBe('C = \uD835\uDC63 + \uFFFD')
    expect(fixed.isWellFormed()).toBe(true)
  })

  it('recurses into plain objects/arrays, keeps well-formed text (emoji / math) intact', () => {
    const params = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'ok 🙂 数学 𝑣' }] }] }
    const out = wellFormValue(params)
    expect(out).toEqual(params)
    expect(out.prompt[0].content[0].text).toBe('ok 🙂 数学 𝑣')
    expect(wellFormValue({ a: ['x\uD835', { b: 'y\uDC63z' }] })).toEqual({
      a: ['x\uFFFD', { b: 'y\uFFFDz' }]
    })
  })

  it('leaves binary and other non-plain objects untouched', () => {
    const bytes = new Uint8Array([0xd8, 0x35, 0x00])
    const url = new URL('https://example.com/a')
    const signal = new AbortController().signal
    const out = wellFormValue({ bytes, url, signal })
    expect(out.bytes).toBe(bytes)
    expect(out.url).toBe(url)
    expect(out.signal).toBe(signal)
  })

  it('sanitizes the outgoing request body through the wrapped model (integration)', async () => {
    const captured: Array<{ prompt: Array<{ content: string }> }> = []
    deepseek.createDeepSeek.mockReturnValue((modelId: string) => ({
      modelId,
      specificationVersion: 'v4',
      doStream: async (params: { prompt: Array<{ content: string }> }) => {
        captured.push(params)
        return { stream: new ReadableStream({ start: (c) => c.close() }) }
      }
    }))
    const model = createModelRuntime({ modelId: 'deepseek-flash', reasoningEffort: 'off' }).model

    await model.doStream({ prompt: [{ role: 'user', content: 'tail\uD835' }] } as never)

    expect(captured[0].prompt[0].content).toBe('tail\uFFFD')
  })

  it('well-forms a tool result before it is resent on the next step of a real multi-step loop', async () => {
    // 走真实 SDK 循环（generateText + 工具执行 + 多步），而非直接调 doXxx：
    // 覆盖正文与标题两条路径中「上一步的工具结果进下一步请求体」这一必经点。
    const requests: Array<{ prompt: Array<unknown> }> = []
    let step = 0
    deepseek.createDeepSeek.mockReturnValue((modelId: string) => ({
      modelId,
      provider: 'deepseek.chat',
      specificationVersion: 'v4',
      supportedUrls: {},
      doGenerate: async (params: { prompt: Array<unknown> }) => {
        requests.push(params)
        step += 1
        const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
        return step === 1
          ? {
              content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'probe', input: '{}' }],
              finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
              usage,
              warnings: []
            }
          : {
              content: [{ type: 'text', text: 'done' }],
              finishReason: { unified: 'stop', raw: 'stop' },
              usage,
              warnings: []
            }
      }
    }))
    const model = createModelRuntime({ modelId: 'deepseek-flash', reasoningEffort: 'off' }).model

    const { text } = await generateText({
      model,
      prompt: 'go',
      stopWhen: stepCountIs(3),
      tools: {
        probe: tool({
          description: 'probe',
          inputSchema: z.object({}),
          execute: () => `cut${'\uD835'}`
        })
      }
    })

    const carried = (
      requests.at(-1)?.prompt.at(-1) as { content: Array<{ output?: { value?: string } }> }
    ).content[0]?.output?.value

    expect(text).toBe('done')
    // 工具结果原样带孤立代理，但重新发出时已清洗（`\uFFFD`），不再是非法码元。
    expect(carried).toBe('cut\uFFFD')
    expect(carried?.isWellFormed()).toBe(true)
  })

  it('treats a whitespace-only own key as unconfigured and falls back to the gateway', () => {
    const runtime = createModelRuntime({
      modelId: 'deepseek-flash',
      reasoningEffort: 'off',
      apiKey: '   '
    })
    expect(deepseek.createDeepSeek).toHaveBeenCalledWith({
      baseURL: 'https://api.larify.ai/v1',
      apiKey: 'sk-test-key'
    })
    expect(runtime.providerOptions).toEqual({
      deepseek: { thinking: { type: 'disabled' } }
    })
  })
})
