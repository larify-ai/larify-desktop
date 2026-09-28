export const modelIds = ['deepseek-flash', 'deepseek-v4-pro'] as const

export type ModelId = (typeof modelIds)[number]
export const reasoningEfforts = ['off', 'high', 'max'] as const
export type ReasoningEffort = (typeof reasoningEfforts)[number]

/**
 * 用户在设置里填了自己的 API Key 时直连的 DeepSeek 官方接口地址。
 * 没填 Key 的请求走 Larify 网关，见 createModelRuntime。
 */
export const officialModelBaseUrl = 'https://api.deepseek.com/v1'

export const modelLabels: Record<ModelId, string> = {
  'deepseek-flash': 'DeepSeek-Flash',
  'deepseek-v4-pro': 'DeepSeek-Pro'
}

export const modelContextWindows: Record<ModelId, { limit: number; rollover: number }> = {
  'deepseek-flash': { limit: 1_000_000, rollover: 500_000 },
  'deepseek-v4-pro': { limit: 1_000_000, rollover: 500_000 }
}

export const imageCapableModelIds = new Set<ModelId>(['deepseek-flash'])

export interface AgentModelConfig {
  modelId: ModelId
  reasoningEffort: ReasoningEffort
  /**
   * 用户在设置里配置的 DeepSeek 官方 API Key。
   *
   * 有值就直连官方、跳过 Larify 网关与账号额度；没值走网关。
   * 由渲染层在发请求时临时附加，不随模型配置落盘，主进程用完即弃。
   */
  apiKey?: string
}

export const defaultModelConfig: AgentModelConfig = {
  modelId: 'deepseek-flash',
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
