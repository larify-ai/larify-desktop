import { generateText } from 'ai'
import { createModelRuntime } from '../model'
import type { AgentModelConfig } from '../model/config'

/**
 * 生成会话标题。
 *
 * 与正文对话请求保持一致：用户配了自有 API Key 就带上，`createModelRuntime`
 * 据此直连官方、跳过网关（不消耗账号额度）；没配 Key 则不传，走网关凭据。
 *
 * @param message 用户首条消息文本
 * @param modelConfig 可选,复用本次会话的模型配置(携带 apiKey 时直连官方)
 */
export async function generateSessionTitle(
  message: string,
  modelConfig?: AgentModelConfig
): Promise<string> {
  const { text } = await generateText({
    ...createModelRuntime({
      modelId: 'deepseek-flash',
      reasoningEffort: 'off',
      ...(modelConfig?.apiKey ? { apiKey: modelConfig.apiKey } : {})
    }),
    prompt: `用户消息：${message}\n\n不要回答用户消息, 只根据用户消息生成一个简短的会话标题\n只输出纯文字标题, 不要包括标点符号, 不要超过5个字`,
    maxOutputTokens: 20
  })

  return text.trim()
}
