export const modelIds = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const

export type ModelId = (typeof modelIds)[number]
export const reasoningEfforts = ['off', 'high', 'max'] as const
export type ReasoningEffort = (typeof reasoningEfforts)[number]

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
  reasoningEffort: ReasoningEffort
}

export const defaultModelConfig: AgentModelConfig = {
  modelId: 'deepseek-v4-flash',
  reasoningEffort: 'off'
}

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && modelIds.includes(value as ModelId)
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return reasoningEfforts.includes(value as ReasoningEffort)
}

export function isAgentModelConfig(value: unknown): value is AgentModelConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<AgentModelConfig>
  return isModelId(config.modelId) && isReasoningEffort(config.reasoningEffort)
}
