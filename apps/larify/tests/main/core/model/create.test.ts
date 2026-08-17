import { beforeEach, describe, expect, it, vi } from 'vitest'

const deepseek = vi.hoisted(() => vi.fn((id: string) => ({ id })))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(() => deepseek)
}))

import { createModelRuntime } from '../../../../src/main/core/model'

beforeEach(() => {
  deepseek.mockClear()
})

describe('createModelRuntime', () => {
  it('creates the configured model and provider options', () => {
    const runtime = createModelRuntime({
      modelId: 'deepseek-v4-pro',
      reasoningEffort: 'max'
    })

    expect(deepseek).toHaveBeenCalledWith('deepseek-v4-pro')
    expect(runtime).toEqual({
      model: { id: 'deepseek-v4-pro' },
      providerOptions: {
        deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'max' }
      }
    })
  })

  it('disables thinking without sending a reasoning effort', () => {
    expect(
      createModelRuntime({ modelId: 'deepseek-v4-flash', reasoningEffort: 'off' }).providerOptions
    ).toEqual({ deepseek: { thinking: { type: 'disabled' } } })
  })

  it('uses the regular official reasoning effort', () => {
    expect(
      createModelRuntime({ modelId: 'deepseek-v4-flash', reasoningEffort: 'high' }).providerOptions
    ).toEqual({
      deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'high' }
    })
  })
})
