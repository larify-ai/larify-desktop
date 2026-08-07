import { describe, expect, it, vi } from 'vitest'
import {
  readModelConfig as readCopiedModelConfig,
  writeModelConfig as writeCopiedModelConfig
} from '../../../src/renderer/src/app/interaction/assistant/model-config'
import { readModelConfig as readOriginalModelConfig } from '../../../src/extensions/assistant/renderer/lib/model-config'
import { defaultModelConfig } from '../../../src/main/core/model/config'

describe('interaction assistant regression baseline', () => {
  it('keeps model configuration behavior identical', () => {
    const storage = { getItem: vi.fn(() => '{"modelId":"deepseek-v4-pro","thinking":"enabled"}') }
    expect(readCopiedModelConfig(storage)).toEqual(readOriginalModelConfig(storage))
  })

  it('falls back to the default model for malformed persisted data', () => {
    const storage = { getItem: vi.fn(() => '{not-json') }
    expect(readCopiedModelConfig(storage)).toEqual(defaultModelConfig)
  })

  it('persists the complete model configuration as one value', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }
    writeCopiedModelConfig(storage, { modelId: 'deepseek-v4-flash', thinking: 'disabled' })
    expect(storage.setItem).toHaveBeenCalledWith(
      'larify.modelConfig',
      '{"modelId":"deepseek-v4-flash","thinking":"disabled"}'
    )
  })
})
