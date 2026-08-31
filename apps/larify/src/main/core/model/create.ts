import { createDeepSeek } from '@ai-sdk/deepseek'
import type { ProviderOptions } from '@ai-sdk/provider-utils'

import { getModelApiService } from '../../model-api/service'
import { defaultModelConfig, type AgentModelConfig } from './config'

export interface ModelRuntime {
  model: ReturnType<ReturnType<typeof createDeepSeek>>
  providerOptions: ProviderOptions
}

export function createModelRuntime(config: AgentModelConfig = defaultModelConfig): ModelRuntime {
  const credentials = getModelApiService().getCachedCredentialsSync()
  if (!credentials) {
    throw new Error('模型凭据未就绪，请先登录并获取凭据。')
  }
  const deepseek = createDeepSeek({
    baseURL: `${credentials.baseUrl}/v1`,
    apiKey: credentials.apiKey
  })
  const thinking = config.reasoningEffort === 'off' ? 'disabled' : 'enabled'
  return {
    model: deepseek(config.modelId),
    providerOptions: {
      deepseek: {
        thinking: { type: thinking },
        ...(thinking === 'enabled' && { reasoningEffort: config.reasoningEffort })
      }
    }
  }
}
