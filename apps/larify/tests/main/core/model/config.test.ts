import { describe, expect, it } from 'vitest'
import { isAgentModelConfig, isModelId, isReasoningEffort } from '../../../../src/main/core/model/config'

describe('model config guards', () => {
  it('accepts valid model ids and reasoning efforts', () => {
    expect(isModelId('deepseek-flash')).toBe(true)
    expect(isModelId('deepseek-v4-pro')).toBe(true)
    expect(isReasoningEffort('off')).toBe(true)
    expect(isReasoningEffort('high')).toBe(true)
    expect(isReasoningEffort('max')).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isModelId('gpt-4o')).toBe(false)
    expect(isModelId(undefined)).toBe(false)
    expect(isReasoningEffort('auto')).toBe(false)
  })

  it('accepts a minimal gateway config', () => {
    expect(isAgentModelConfig({ modelId: 'deepseek-flash', reasoningEffort: 'off' })).toBe(true)
  })

  it('accepts an own-api-key config without stripping the apiKey field', () => {
    // runtime.ts 守卫通过后用原对象，不会重建/裁剪字段——若未来改成
    // pick 字段会静默丢掉用户配置的 Key，此用例锁住该语义。
    const config = { modelId: 'deepseek-v4-pro', reasoningEffort: 'max', apiKey: 'sk-own' }
    expect(isAgentModelConfig(config)).toBe(true)
    expect(config.apiKey).toBe('sk-own')
  })

  it('rejects configs with an invalid model id or effort', () => {
    expect(isAgentModelConfig({ modelId: 'gpt-4o', reasoningEffort: 'off' })).toBe(false)
    expect(isAgentModelConfig({ modelId: 'deepseek-flash', reasoningEffort: 'auto' })).toBe(false)
    expect(isAgentModelConfig(null)).toBe(false)
  })
})
