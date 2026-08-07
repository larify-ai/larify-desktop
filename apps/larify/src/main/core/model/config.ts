export const modelIds = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const

export type ModelId = (typeof modelIds)[number]
export type ThinkingMode = 'disabled' | 'enabled'

export const modelLabels: Record<ModelId, string> = {
  'deepseek-v4-flash': 'DeepSeek-V4-Flash',
  'deepseek-v4-pro': 'DeepSeek-V4-Pro'
}

export const modelContextWindows: Record<ModelId, { limit: number; rollover: number }> = {
  'deepseek-v4-flash': { limit: 1_000_000, rollover: 800_000 },
  'deepseek-v4-pro': { limit: 1_000_000, rollover: 800_000 }
}

export interface AgentModelConfig {
  modelId: ModelId
  thinking: ThinkingMode
}

export const defaultModelConfig: AgentModelConfig = {
  modelId: 'deepseek-v4-flash',
  thinking: 'disabled'
}

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && modelIds.includes(value as ModelId)
}

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return value === 'disabled' || value === 'enabled'
}

export function isAgentModelConfig(value: unknown): value is AgentModelConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<AgentModelConfig>
  return isModelId(config.modelId) && isThinkingMode(config.thinking)
}
