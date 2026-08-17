import { describe, expect, it, vi } from 'vitest'
import {
  readModelConfig,
  writeModelConfig
} from '../../../src/renderer/src/app/interaction/assistant/model-config'
import { defaultModelConfig } from '../../../src/main/core/model/config'

describe('interaction assistant model configuration', () => {
  it('falls back to the default model for malformed persisted data', () => {
    const storage = { getItem: vi.fn(() => '{not-json') }
    expect(readModelConfig(storage)).toEqual(defaultModelConfig)
  })

  it('persists the complete model configuration as one value', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }
    writeModelConfig(storage, { modelId: 'deepseek-v4-flash', thinking: 'disabled' })
    expect(storage.setItem).toHaveBeenCalledWith(
      'larify.modelConfig',
      '{"modelId":"deepseek-v4-flash","thinking":"disabled"}'
    )
  })
})
