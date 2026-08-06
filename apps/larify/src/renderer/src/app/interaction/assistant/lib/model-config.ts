import {
  defaultModelConfig,
  isAgentModelConfig,
  type AgentModelConfig
} from '../../../../../../extensions/agent/shared/model'

export const MODEL_CONFIG_KEY = 'larify.modelConfig'

type ModelConfigStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readModelConfig(storage: ModelConfigStorage): AgentModelConfig {
  try {
    const value = JSON.parse(storage.getItem(MODEL_CONFIG_KEY) ?? 'null')
    return isAgentModelConfig(value) ? value : defaultModelConfig
  } catch {
    return defaultModelConfig
  }
}

export function writeModelConfig(storage: ModelConfigStorage, value: AgentModelConfig): void {
  storage.setItem(MODEL_CONFIG_KEY, JSON.stringify(value))
}
