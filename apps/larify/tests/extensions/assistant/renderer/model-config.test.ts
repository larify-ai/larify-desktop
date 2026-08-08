import { describe, expect, it, vi } from 'vitest'
import {
  MODEL_CONFIG_KEY,
  readModelConfig,
  writeModelConfig
} from '../../../../src/extensions/assistant/renderer/lib/model-config'
import { defaultModelConfig } from '../../../../src/main/core/model/config'

describe('model configuration persistence', () => {
  it('restores a persisted model and thinking mode', () => {
    const config = { modelId: 'deepseek-v4-flash', thinking: 'enabled' } as const
    const storage = {
      getItem: vi.fn(() => JSON.stringify(config)),
      setItem: vi.fn()
    }

    expect(readModelConfig(storage)).toEqual(config)
  })

  it('falls back when persisted data is invalid', () => {
    const storage = { getItem: vi.fn(() => '{}'), setItem: vi.fn() }
    expect(readModelConfig(storage)).toEqual(defaultModelConfig)
  })

  it('stores model and thinking mode together', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }
    const config = { modelId: 'deepseek-v4-pro', thinking: 'disabled' } as const

    writeModelConfig(storage, config)

    expect(storage.setItem).toHaveBeenCalledWith(MODEL_CONFIG_KEY, JSON.stringify(config))
  })
})
