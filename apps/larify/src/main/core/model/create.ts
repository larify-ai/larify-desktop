import { createDeepSeek } from '@ai-sdk/deepseek'
import type { ProviderOptions } from '@ai-sdk/provider-utils'

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

export function createModelRuntime(config: AgentModelConfig = defaultModelConfig): ModelRuntime {
  // 凭据二选一：用户自带 Key → 直连官方（不消耗账号额度）；否则走网关凭据。
  // 推理参数（thinking/reasoningEffort）两路一致：官方接口同样支持。
  const ownApiKey = config.apiKey?.trim() ?? ''
  const viaGateway = ownApiKey === ''
  const deepseek = createDeepSeek(
    viaGateway ? gatewayCredentials() : { baseURL: officialModelBaseUrl, apiKey: ownApiKey }
  )

  return {
    model: deepseek(config.modelId),
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
