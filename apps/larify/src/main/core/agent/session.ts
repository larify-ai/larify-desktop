import { createUIMessageStream, toUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { errorMessage } from '../../utils/error'
import { runAgent, type AgentOptions } from './engine'
import { toModelMessages } from './messages'

// 跨 run 复用时，渲染端 `@ai-sdk/react` 会用 mergeObjects 顶层覆盖 startedAt/completedAt：
// 新一轮 run 的 start 会写入较新的 startedAt，而旧 run 残留的 completedAt 若未及时被覆盖，
// 就会出现 completedAt < startedAt 的「时间倒挂」，导致前端 `hasValidDuration` 判定失败
// （处理时长显示异常）。这里对输出的消息做兜底归一化：保证 completedAt >= startedAt。
export function normalizeMessageMetadata(message: UIMessage): UIMessage {
  const metadata = (message.metadata ?? {}) as Record<string, unknown> | undefined
  if (!metadata) return message
  const startedAt = metadata.startedAt
  const completedAt = metadata.completedAt
  const hasStartedAt = typeof startedAt === 'number' && Number.isFinite(startedAt)
  const hasCompletedAt = typeof completedAt === 'number' && Number.isFinite(completedAt)
  if (!hasStartedAt || !hasCompletedAt || (completedAt as number) >= (startedAt as number)) {
    return message
  }
  return {
    ...message,
    metadata: { ...metadata, completedAt: startedAt }
  }
}

export async function runAgentSession(
  messages: UIMessage[],
  options: AgentOptions,
  onChunk?: (chunk: UIMessageChunk) => void,
  onMessage?: (message: UIMessage) => void
): Promise<UIMessage[]> {
  const startedAt = Date.now()
  // 跨 run 累加纯处理时长：
  // - 从 messages 末尾向前找最后一条 assistant 的 totalProcessingMs
  // - 遇到真实用户消息（role=user 且非 metadata.compaction）中断（新一轮用户问题，重置计时）
  // - metadata.compaction=true 的 user 是 reset_context 插入的 handoff 消息，不算新问题，跳过
  const previousTotalProcessingMs = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'user') {
        const meta = msg.metadata as Record<string, unknown> | undefined
        if (meta?.compaction !== true) return 0
        continue
      }
      if (msg.role === 'assistant') {
        const total = (msg.metadata as Record<string, unknown> | undefined)?.totalProcessingMs
        if (typeof total === 'number' && Number.isFinite(total)) return total
        return 0
      }
    }
    return 0
  })()
  const agentStream = runAgent(await toModelMessages(messages, options.tools), options)
  let finalMessages = messages
  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: errorMessage,
    execute: async ({ writer }) => {
      const uiStream = toUIMessageStream({
        stream: agentStream,
        onError: errorMessage,
        messageMetadata: ({ part }) => {
          if (part.type === 'start') {
            return previousTotalProcessingMs > 0
              ? { startedAt, totalProcessingMs: previousTotalProcessingMs }
              : { startedAt }
          }
          if (part.type === 'finish') {
            const completedAt = Math.max(Date.now(), startedAt)
            return {
              completedAt,
              totalProcessingMs: previousTotalProcessingMs + (completedAt - startedAt)
            }
          }
          if (part.type === 'abort') {
            const completedAt = Math.max(Date.now(), startedAt)
            return {
              completedAt,
              outcome: 'aborted' as const,
              totalProcessingMs: previousTotalProcessingMs + (completedAt - startedAt)
            }
          }
          return undefined
        }
      })
      const reader = uiStream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          writer.write(value)
        }
      } catch (error) {
        writer.write({ type: 'error', errorText: errorMessage(error) })
        const errorCompletedAt = Math.max(Date.now(), startedAt)
        writer.write({
          type: 'message-metadata',
          messageMetadata: {
            completedAt: errorCompletedAt,
            outcome: 'error',
            totalProcessingMs: previousTotalProcessingMs + (errorCompletedAt - startedAt)
          }
        })
      } finally {
        reader.releaseLock()
      }
    },
    onStepEnd: ({ responseMessage }) =>
      onMessage?.(normalizeMessageMetadata(responseMessage)),
    onEnd: (event) => {
      finalMessages = event.messages
    }
  })
  for await (const chunk of stream) onChunk?.(chunk)
  return finalMessages.map(normalizeMessageMetadata)
}
