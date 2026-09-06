import type { UIMessage, UIMessageChunk } from 'ai'
import type { SessionStore } from '../session'
import { saveSessionMessages } from '../session/save'
import { generateSessionTitle } from '../session/title'
import type { AgentModelConfig } from '../model/config'
import type { AgentOptions } from './engine'
import { prepareMessages } from './messages'
import { runAgentSession } from './session'

export interface AgentRequest {
  sessionId: string
  title?: string
  cwd: string
  message: UIMessage
  options: AgentOptions
  onChunk?: (chunk: UIMessageChunk) => void
  onTitle?: (title: string) => void
  /** 复用本次会话模型配置（携带 apiKey 时标题生成同样直连官方、不消耗网关额度）。 */
  modelConfig?: AgentModelConfig
}

export async function runStoredAgentSession(
  sessions: SessionStore,
  request: AgentRequest
): Promise<UIMessage | undefined> {
  const { sessionId, cwd, message, options, onChunk, modelConfig } = request
  const text = message.parts.find((part) => part.type === 'text')?.text.trim() ?? ''
  const shouldGenerateTitle =
    request.title === undefined && !sessions.hasSession(sessionId) && text.length >= 6

  saveSessionMessages(sessions, sessionId, cwd, [message], request.title)
  const titleTask = shouldGenerateTitle
    ? generateSessionTitle(text, modelConfig)
        .then((title) => {
          if (!title) return
          sessions.renameSession(sessionId, title)
          request.onTitle?.(title)
        })
        .catch(() => {})
    : undefined
  const messages = await prepareMessages(sessions.loadMessages(sessionId))
  // reset_context 续写：模型输入末尾是 compaction user，AI SDK 据此判定新消息 → UI 多一条
  // 「已完成」。这里读截断前最后一条 assistant 并入 UI 消息身份判定（originalMessages 末尾
  // 是 assistant），使 AI SDK 复用其 id 合并成一条、时长跨段连续。模型输入 messages 不变
  // （压缩保留）；仅 reset 续写（末尾 compaction）才读，普通提问末尾是 assistant 不读。
  const lastMsg = messages.at(-1)
  const isCompaction =
    lastMsg?.role === 'user' &&
    (lastMsg?.metadata as Record<string, unknown> | undefined)?.compaction === true
  const continuationOf = isCompaction
    ? sessions.loadLastAssistantBeforeStart(sessionId)
    : undefined
  const uiOriginalMessages = continuationOf ? [...messages, continuationOf] : undefined
  let latestResponse: UIMessage | undefined
  const finalMessages = await runAgentSession(messages, options, onChunk, (response) => {
    latestResponse = response
    sessions.saveMessages(sessionId, [response])
  }, uiOriginalMessages)
  // originalMessages（含 continuationOf）可能比 messages 长；AI SDK 在续写时把合并后的消息放
  // 末尾，故取末尾 assistant，而非 slice(messages.length)（会把旧历史误当本轮新增）。
  const finalResponse = finalMessages.at(-1)
  const isAssistant = finalResponse?.role === 'assistant'
  if (isAssistant && finalResponse) {
    latestResponse = finalResponse
    sessions.saveMessages(sessionId, [finalResponse])
  }
  await titleTask
  return latestResponse
}
