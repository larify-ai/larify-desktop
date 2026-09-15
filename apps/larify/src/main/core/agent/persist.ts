import type { UIMessage, UIMessageChunk } from 'ai'
import type { SessionStore } from '../session'
import { saveSessionMessages } from '../session/save'
import { generateSessionTitle } from '../session/title'
import type { AgentModelConfig } from '../model/config'
import type { AgentOptions } from './engine'
import { prepareMessages } from './messages'
import { runAgentSession } from './session'

/** 递归子任务的消息打上 nested 标记：仅 UI 可见，不进主链上下文（loadMessages 过滤）。 */
export function markNested(value: UIMessage): UIMessage {
  return {
    ...value,
    metadata: { ...(value.metadata as Record<string, unknown> | undefined), nested: true }
  }
}

/**
 * 把「一轮的模型输出」换算为**应落库**的消息。
 * - 非嵌套（含主链）：原样（可选打 nested 标记由 tag 决定）。
 * - 嵌套轮次：其 `value.id` 是主链 anchor 的 id（UI 身份复用），且 `value.parts` = anchor.parts
 *   + 子轮增量。若按原值落库会用嵌套标记覆盖主链行，故这里**只取增量**并换新 id。
 * worker 的变更快照回写（saveReview）与 persist 的常规落库复用本函数，保证同一套语义。
 */
export function nestStoredMessage(
  value: UIMessage,
  tag: (value: UIMessage) => UIMessage,
  anchor: UIMessage | undefined
): UIMessage {
  if (!anchor) return tag(value)
  return markNested({
    ...value,
    id: `${value.id}-nested`,
    parts: value.parts.slice(anchor.parts.length)
  })
}

export interface AgentRequest {
  sessionId: string
  title?: string
  cwd: string
  /** 本轮新增的用户消息；为 undefined 表示"在主链上续跑"（直接用已有历史，从末尾 assistant 之后继续）。 */
  message?: UIMessage
  options: AgentOptions
  onChunk?: (chunk: UIMessageChunk) => void
  onTitle?: (title: string) => void
  /** 复用本次会话模型配置（携带 apiKey 时标题生成同样直连官方、不消耗网关额度）。 */
  modelConfig?: AgentModelConfig
  /** 递归子任务：消息只在 UI 可见，不作为主链上下文喂回模型。 */
  nested?: boolean
  /** 递归前几轮已累计的处理时长（ms）：嵌套各轮独立上下文，无法从消息里推导，需显式传入。 */
  baseProcessingMs?: number
}

export async function runStoredAgentSession(
  sessions: SessionStore,
  request: AgentRequest
): Promise<UIMessage | undefined> {
  const { sessionId, cwd, message, options, onChunk, modelConfig } = request
  const tag = (value: UIMessage): UIMessage => (request.nested ? markNested(value) : value)
  const text = message?.parts.find((part) => part.type === 'text')?.text.trim() ?? ''
  const shouldGenerateTitle =
    message !== undefined &&
    request.title === undefined &&
    !sessions.hasSession(sessionId) &&
    text.length >= 6

  // message 为 undefined 表示主链续跑（子任务链结束回到主任务），不新增消息：主链末尾已是
  // 含 `agent_schedule_task` 结果的 assistant，AI SDK 会从其之后继续。
  if (message) saveSessionMessages(sessions, sessionId, cwd, [tag(message)], request.title)
  const titleTask = shouldGenerateTitle
    ? generateSessionTitle(text, modelConfig)
        .then((title) => {
          if (!title) return
          sessions.renameSession(sessionId, title)
          request.onTitle?.(title)
        })
        .catch(() => {})
    : undefined
  // 递归子任务用全新上下文：只喂本轮 nest prompt，不带最上层与其它子任务的消息。
  // 跨层信息只经 task.md 传递（见 nest/prompt.md 生成的判据）。其余情况（主链续跑）加载主链历史。
  const messages =
    request.nested && message ? [message] : await prepareMessages(sessions.loadMessages(sessionId))

  // reset_context 续写：模型输入末尾是 compaction user，AI SDK 据此判定新消息 → UI 多一条
  // 「已完成」。这里读截断前最后一条 assistant 并入 UI 消息身份判定（originalMessages 末尾
  // 是 assistant），使 AI SDK 复用其 id 合并成一条、时长跨段连续。模型输入 messages 不变
  // （压缩保留）；仅 reset 续写（末尾 compaction）才读，普通提问末尾是 assistant 不读。
  const lastMsg = messages.at(-1)
  const isCompaction =
    !request.nested &&
    lastMsg?.role === 'user' &&
    (lastMsg?.metadata as Record<string, unknown> | undefined)?.compaction === true
  const continuationOf = isCompaction ? sessions.lastAssistant(sessionId, 'before') : undefined
  // UI 消息身份（originalMessages）与模型输入（messages）分离：
  // - reset 续写：并入 reset 前 assistant，末尾是 assistant → AI SDK 复用其 id 合并成一条。
  // - 递归子任务轮次：模型输入是独立上下文 [nest prompt]，但 UI 身份要挂在**主链最后一条
  //   assistant** 上。否则渲染端 AI SDK 的 Chat 会为该轮新建一条 assistant 消息（messageId
  //   与客户端已有的主链 assistant 不同 → replaceLastMessage 失败 → pushMessage），且新消息
  //   以主链 assistant 的全部 parts 为起点再追加子轮 parts → **UI 出现重复的父轮阶段**。
  //   传入 [lastMainAssistant]（末尾是 assistant）后，AI SDK 会给流内 start chunk 盖上该
  //   assistant 的 id，渲染端据此复用并合并成一条。模型输入 messages 不变。
  const nestedAnchor =
    request.nested && message ? sessions.lastAssistant(sessionId, 'after') : undefined
  const uiOriginalMessages = continuationOf
    ? [...messages, continuationOf]
    : nestedAnchor
      ? [nestedAnchor]
      : undefined
  // 统一的落库入口：把「模型输出」换算为**落库身份**（nested 轮次即「增量 + 新 id」那条）后入库，
  // 并记下最近一次的身份——返回给 worker 的变更快照回写（saveReview）在同一身份上原地替换，
  // 避免把快照写到主链 anchor 行上。
  let latestStored: UIMessage | undefined
  const saveResponse = (response: UIMessage): void => {
    const stored = nestStoredMessage(response, tag, nestedAnchor)
    latestStored = stored
    sessions.saveMessages(sessionId, [stored])
  }
  const finalMessages = await runAgentSession(
    messages,
    options,
    onChunk,
    saveResponse,
    uiOriginalMessages,
    request.baseProcessingMs
  )
  // originalMessages（含 continuationOf）可能比 messages 长；AI SDK 在续写时把合并后的消息放
  // 末尾，故取末尾 assistant，而非 slice(messages.length)（会把旧历史误当本轮新增）。
  const finalResponse = finalMessages.at(-1)
  if (finalResponse?.role === 'assistant') saveResponse(finalResponse)
  await titleTask
  return latestStored
}
