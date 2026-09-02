import { createContext, useContext } from 'react'
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

// 会话级模型配置：按 sessionId 单独存储，与全局默认值解耦。
// 读取优先级为"会话固化值 > 全局默认值"。
function sessionModelKey(sessionId: string): string {
  return `${MODEL_CONFIG_KEY}.${sessionId}`
}

export function readSessionModelConfig(
  sessionId: string,
  storage: ModelConfigStorage
): AgentModelConfig {
  let value: unknown
  try {
    value = JSON.parse(storage.getItem(sessionModelKey(sessionId)) ?? 'null')
  } catch {
    value = null
  }
  if (isAgentModelConfig(value)) return value
  // 会话未固化过，回退全局默认
  return readModelConfig(storage)
}

export function writeSessionModelConfig(
  sessionId: string,
  storage: ModelConfigStorage,
  value: AgentModelConfig
): void {
  storage.setItem(sessionModelKey(sessionId), JSON.stringify(value))
}

// 会话级模型配置的 React Context：由 AssistantSession 提供，
// 让深层的 ModelSelector 无需经过 chat/composer 逐层透传 props。
export interface ModelConfigContextValue {
  value: AgentModelConfig
  onChange: (config: AgentModelConfig) => void
}

export const ModelConfigContext = createContext<ModelConfigContextValue | null>(null)

export function useModelConfig(): ModelConfigContextValue {
  const context = useContext(ModelConfigContext)
  if (!context) throw new Error('ModelConfigContext is missing.')
  return context
}
