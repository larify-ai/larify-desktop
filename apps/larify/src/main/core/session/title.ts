import { generateText } from 'ai'
import { createModelRuntime } from '../model'

export async function generateSessionTitle(message: string): Promise<string> {
  const { text } = await generateText({
    ...createModelRuntime({ modelId: 'deepseek-v4-flash', reasoningEffort: 'off' }),
    prompt: `用户消息：${message}\n\n不要回答用户消息, 只根据用户消息生成一个简短的会话标题\n只输出纯文字标题, 不要包括标点符号, 不要超过5个字`,
    maxOutputTokens: 20
  })

  return text.trim()
}
