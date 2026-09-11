import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  ModelConfigContext,
  readModelConfig,
  writeModelConfig
} from '../../../src/renderer/src/app/interaction/assistant/model-config'
import { defaultModelConfig } from '../../../src/main/core/model/config'
import { ModelSelector } from '../../../src/renderer/src/app/interaction/assistant/model-selector'

describe('interaction assistant model configuration', () => {
  it('renders with the default model when browser storage is unavailable', () => {
    // ModelSelector 经 useModelConfig 读取配置；SSR 下无 browser storage，
    // 由 AssistantSession 降级为 defaultModelConfig 后传入。测试用等值 Provider 支撑。
    expect(
      renderToString(
        createElement(
          ModelConfigContext.Provider,
          { value: { value: defaultModelConfig, onChange: () => undefined } },
          createElement(ModelSelector)
        )
      )
    ).toContain('DeepSeek-Flash')
  })

  it('falls back to the default model for malformed persisted data', () => {
    const storage = { getItem: vi.fn(() => '{not-json'), setItem: vi.fn() }
    expect(readModelConfig(storage)).toEqual(defaultModelConfig)
  })

  it('overwrites legacy model configuration with the current default', () => {
    const storage = {
      getItem: vi.fn(() => '{"modelId":"deepseek-v4-pro","thinking":"enabled"}'),
      setItem: vi.fn()
    }
    expect(readModelConfig(storage)).toEqual(defaultModelConfig)
    expect(storage.setItem).toHaveBeenCalledWith(
      'larify.modelConfig',
      JSON.stringify(defaultModelConfig)
    )
  })

  it('persists the complete model configuration as one value', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }
    writeModelConfig(storage, { modelId: 'DeepSeek-Flash', reasoningEffort: 'off' })
    expect(storage.setItem).toHaveBeenCalledWith(
      'larify.modelConfig',
      '{"modelId":"DeepSeek-Flash","reasoningEffort":"off"}'
    )
  })
})
