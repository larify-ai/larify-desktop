import { createDeepSeek } from '@ai-sdk/deepseek'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { defaultModelConfig, type AgentModelConfig } from './config'

const deepseek = createDeepSeek({
  baseURL: 'https://api.deepseek.com',
  apiKey: 'sk-51d1b62d722148e6973c420d5d900faf'
})

export interface ModelRuntime {
  model: ReturnType<typeof deepseek>
  providerOptions: ProviderOptions
}

export function createModelRuntime(config: AgentModelConfig = defaultModelConfig): ModelRuntime {
  return {
    model: deepseek(config.modelId),
    providerOptions: { deepseek: { thinking: { type: config.thinking } } }
  }
}
