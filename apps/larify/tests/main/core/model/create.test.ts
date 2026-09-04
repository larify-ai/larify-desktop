import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { createModelRuntime } from '../../../../src/main/core/model/create'
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
    expect(() => createModelRuntime({ modelId: 'deepseek-v4-flash', reasoningEffort: 'off' })).toThrow(
      '模型凭据未就绪'
    )
  })

  it('points the DeepSeek client at the gateway with the user token', () => {
    createModelRuntime({ modelId: 'deepseek-v4-flash', reasoningEffort: 'off' })
    expect(deepseek.createDeepSeek).toHaveBeenCalledWith({
      baseURL: 'https://api.larify.ai/v1',
      apiKey: 'sk-test-key'
    })
  })

  it('uses the configured model id', () => {
    const runtime = createModelRuntime({ modelId: 'deepseek-v4-pro', reasoningEffort: 'off' })
    expect(runtime.model).toEqual({ modelId: 'deepseek-v4-pro' })
  })

  it('maps reasoningEffort off to thinking:disabled (no reasoning_effort sent)', () => {
    const runtime = createModelRuntime({ modelId: 'deepseek-v4-flash', reasoningEffort: 'off' })
    expect(runtime.providerOptions).toEqual({
      deepseek: { thinking: { type: 'disabled' } }
    })
  })

  it('maps reasoningEffort high to thinking:enabled + reasoningEffort high', () => {
    const runtime = createModelRuntime({ modelId: 'deepseek-v4-flash', reasoningEffort: 'high' })
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
    expect(runtime.model).toEqual({ modelId: 'deepseek-v4-flash-vision-exp' })
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
      modelId: 'deepseek-v4-flash',
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
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'max',
      apiKey: 'sk-own'
    })
    expect(runtime.model).toEqual({ modelId: 'deepseek-v4-flash' })
    expect(runtime.providerOptions).toEqual({
      deepseek: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'max'
      }
    })
  })

  it('treats a whitespace-only own key as unconfigured and falls back to the gateway', () => {
    const runtime = createModelRuntime({
      modelId: 'deepseek-v4-flash',
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
