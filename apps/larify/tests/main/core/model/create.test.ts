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
      thinking: 'enabled'
    })

    expect(deepseek).toHaveBeenCalledWith('deepseek-v4-pro')
    expect(runtime).toEqual({
      model: { id: 'deepseek-v4-pro' },
      providerOptions: { deepseek: { thinking: { type: 'enabled' } } }
    })
  })
})
