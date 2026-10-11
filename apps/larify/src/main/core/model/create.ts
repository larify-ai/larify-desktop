import { createDeepSeek } from '@ai-sdk/deepseek'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai'

import { getModelApiService } from '../../model-api/service'
import { defaultModelConfig, officialModelBaseUrl, type AgentModelConfig } from './config'

export interface ModelRuntime {
  model: ReturnType<ReturnType<typeof createDeepSeek>>
  providerOptions: ProviderOptions
}

interface DeepSeekCredentials {
  baseURL: string
  apiKey: string
}

export function wellFormValue<T>(value: T): T {
  if (typeof value === 'string') return value.toWellFormed() as unknown as T
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => wellFormValue(item)) as unknown as T
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, wellFormValue(item)])
  ) as T
}

// 请求边界：孤立代理无法编码成合法请求体，服务端会返回裸 400 Bad Request。
const wellForm = {
  transformParams: async ({ params }) => wellFormValue(params)
} satisfies LanguageModelMiddleware

export function createModelRuntime(config: AgentModelConfig = defaultModelConfig): ModelRuntime {
  // 凭据二选一：用户自带 Key → 直连官方（不消耗账号额度）；否则走网关凭据。
  // 推理参数（thinking/reasoningEffort）两路一致：官方接口同样支持。
  const ownApiKey = config.apiKey?.trim() ?? ''
  const viaGateway = ownApiKey === ''
  const deepseek = createDeepSeek(
    viaGateway ? gatewayCredentials() : { baseURL: officialModelBaseUrl, apiKey: ownApiKey }
  )

  return {
    model: wrapLanguageModel({ model: deepseek(config.modelId), middleware: [wellForm] }),
    providerOptions: buildProviderOptions(config)
  }
}

function buildProviderOptions(config: AgentModelConfig): ProviderOptions {
  const thinking = config.reasoningEffort === 'off' ? 'disabled' : 'enabled'
  return {
    deepseek: {
      thinking: { type: thinking },
      ...(thinking === 'enabled' && { reasoningEffort: config.reasoningEffort })
    }
  }
}

function gatewayCredentials(): DeepSeekCredentials {
  const credentials = getModelApiService().getCachedCredentialsSync()
  if (!credentials) {
    throw new Error('模型凭据未就绪，请先登录并获取凭据。')
  }
  return { baseURL: `${credentials.baseUrl}/v1`, apiKey: credentials.apiKey }
}
