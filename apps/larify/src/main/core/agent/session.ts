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
  onMessage?: (message: UIMessage) => void,
  uiOriginalMessages?: UIMessage[],
  baseProcessingMs = 0,
  /**
   * 本轮流**响应消息 id**。给定时透传给 `createUIMessageStream.generateId`：`createUIMessageStream`
   * 用它作为流响应 id（再由 `handleUIMessageStreamFinish` 注入 `start` chunk），而 AI SDK 的
   * `getResponseUIMessageId` 只在 `originalMessages` 末条**不是** assistant 时才采用它（否则强制
   * 复用末条 assistant 的 id）。reset 续写轮据此把流 id 定为「reset 新行 id（`resetStoredId`）」⇒
   * 渲染端末端 id 收敛到 `sessions.start` 之后 ⇒ 后续 ask_user 回答天然可被模型读到（见 persist.ts）。
   *
   * ⚠️ 必须传 `generateId`（不是 `generateMessageId`）：`createUIMessageStream` 只解构
   * `generateId`，未识别键会被**静默忽略** ⇒ 否则流 id 会退化成随机 id，与落库身份不一致。
   */
  responseId?: string
): Promise<UIMessage[]> {
  const startedAt = Date.now()
  // 跨 run 累加纯处理时长：
  // - 从 messages 末尾向前找最后一条 assistant 的 totalProcessingMs
  // - 遇到真实用户消息（role=user 且非 metadata.compaction）中断（新一轮用户问题，重置计时）
  // - metadata.compaction=true 的 user 是 reset_context 插入的 handoff 消息，不算新问题，跳过
  // 跨 run 累加纯处理时长（基数从 uiOriginalMessages 找）：reset 续写时 uiOriginalMessages 末尾是
  // reset 前 assistant（continuationOf），带旧段累计 totalProcessingMs；而 messages（截断版）会被
  // sessions.start 截断、不含 reset 前 assistant，从它找会丢失旧段。故用 uiOriginalMessages 作累加
  // 基数来源，使合并成一条后的总时长 = 旧段累计 + 本段新增。
  // 遇 compaction（metadata.compaction=true）跳过；遇真实用户消息中断（新一轮问题，重置计时）。
  const previousTotalProcessingMs =
    baseProcessingMs > 0
      ? baseProcessingMs
      : (() => {
          const source = uiOriginalMessages ?? messages
          for (let i = source.length - 1; i >= 0; i--) {
            const msg = source[i]
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
  const errorMetadata = (
    reason: string
  ): { type: 'message-metadata'; messageMetadata: Record<string, unknown> } => {
    const errorCompletedAt = Math.max(Date.now(), startedAt)
    return {
      type: 'message-metadata',
      messageMetadata: {
        completedAt: errorCompletedAt,
        outcome: 'error',
        error: reason,
        totalProcessingMs: previousTotalProcessingMs + (errorCompletedAt - startedAt)
      }
    }
  }
  // AI SDK 只在 originalMessages 末尾是 assistant 时复用其 id 并在其上追加 parts（UI 合并成一条）。
  // 模型输入 messages（compaction 截断版）末尾是 compaction user → 判定新消息。uiOriginalMessages
  // 由 persist 在 reset 续写时并入 reset 前 assistant（末尾变 assistant），使合并成立；模型输入
  // messages 不变（上下文压缩保留），且 originalMessages 的额外消息不进模型。
  const stream = createUIMessageStream({
    originalMessages: uiOriginalMessages ?? messages,
    ...(responseId !== undefined ? { generateId: () => responseId } : {}),
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
            // 透出 finishReason，用于区分「正常 stop」与「断流 other/error」：
            // 断流（DeepSeek insufficient_system_resource→error、无 finish→other）
            // 在内容已流出后不被 ai-retry 重试，finish 原样流向下游，此时若不记录
            // finishReason，数据库里断流与正常 stop 无法区分（都无 outcome）。
            const finishReason = (part as { finishReason?: unknown }).finishReason
            const metadata: Record<string, unknown> = {
              completedAt,
              totalProcessingMs: previousTotalProcessingMs + (completedAt - startedAt)
            }
            if (finishReason != null && typeof finishReason === 'string') {
              metadata.finishReason = finishReason
            }
            return metadata
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
      // 必须先写 message-metadata 再写 error：渲染端收到 error chunk 会抛错中断消费，
      // 之后的 chunk（含 metadata）将不再被应用，导致 UI 内存中的消息丢失 outcome/error。
      const writeError = (reason: string, raw?: unknown): void => {
        writer.write(errorMetadata(reason))
        writer.write({ type: 'error', errorText: reason })
        // 主进程留痕：用户主动停止（AbortError）属预期路径，降级为 warn 避免终端误报错误。
        if ((raw as { name?: string } | null)?.name === 'AbortError') {
          console.warn('[agent] stream aborted:', reason)
        } else {
          console.error('[agent] stream failed:', reason)
        }
      }
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          // AI SDK 把底层模型错误转成 error chunk 流出（不抛异常），
          // 必须在这里补写错误 metadata；catch 仅兜底流本身真的抛错的场景。
          if (value.type === 'error') writeError(value.errorText)
          else writer.write(value)
        }
      } catch (error) {
        writeError(errorMessage(error), error)
      } finally {
        reader.releaseLock()
      }
    },
    onStepEnd: ({ responseMessage }) => onMessage?.(normalizeMessageMetadata(responseMessage)),
    onEnd: (event) => {
      finalMessages = event.messages
    }
  })
  for await (const chunk of stream) onChunk?.(chunk)
  return finalMessages.map(normalizeMessageMetadata)
}
