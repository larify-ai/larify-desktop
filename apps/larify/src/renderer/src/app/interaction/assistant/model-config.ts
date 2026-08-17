import {
  defaultModelConfig,
  isAgentModelConfig,
  type AgentModelConfig
} from '../../../../../main/core/model/config'

export const MODEL_CONFIG_KEY = 'larify.modelConfig'

type ModelConfigStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readModelConfig(storage: ModelConfigStorage): AgentModelConfig {
  let value: unknown
  try {
    value = JSON.parse(storage.getItem(MODEL_CONFIG_KEY) ?? 'null')
  } catch {
    value = null
  }
  if (isAgentModelConfig(value)) return value
  try {
    writeModelConfig(storage, defaultModelConfig)
  } catch {
    return defaultModelConfig
  }
  return defaultModelConfig
}

export function writeModelConfig(storage: ModelConfigStorage, value: AgentModelConfig): void {
  storage.setItem(MODEL_CONFIG_KEY, JSON.stringify(value))
}
