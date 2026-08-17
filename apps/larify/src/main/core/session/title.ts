import { generateText } from 'ai'
import { createModelRuntime } from '../model'

export async function generateSessionTitle(message: string): Promise<string> {
  const { text } = await generateText({
    ...createModelRuntime({ modelId: 'deepseek-v4-flash', reasoningEffort: 'off' }),
    prompt: `用户消息：${message}\n\n根据用户消息生成一个简短的会话标题\n只输出纯文字标题不要任何标点符号`,
    maxOutputTokens: 20
  })

  return text.trim()
}
