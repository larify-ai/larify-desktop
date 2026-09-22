import type { UIMessage, UIMessageChunk } from 'ai'
import { randomUUID } from 'node:crypto'
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

/** 嵌套（递归子任务）assistant 行的落库 id 后缀，`nestedRowId` 是唯一生产者。 */
export const NESTED_ID_SUFFIX = '-nested-'

/**
 * 嵌套行的落库 id：`<主链行 id>-nested-<suffix>`。
 *
 * - id 基必须取**主链行**（稳定不变）；若用「上一轮嵌套行」作基，后缀会层层叠加（实测 60→588 字符）。
 * - suffix **每轮唯一**，否则多轮嵌套会因 `ON CONFLICT(session_id,id) DO UPDATE` 互相覆盖。
 * - `nested` 标记与 id 后缀**同源**（都由 `locateCurrentRow` 的 `nestedRow` 决定），不另设推断处。
 */
export function nestedRowId(idBase: UIMessage | undefined, suffix: string | undefined): string {
  return `${idBase?.id ?? 'nested'}${NESTED_ID_SUFFIX}${suffix ?? 'x'}`
}

export interface AgentRequest {
  sessionId: string
  title?: string
  cwd: string
  /** 本轮的输入消息：首轮是用户消息，被调度任务的轮次是 nest 判据，ask_user 续写是回答。 */
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
  /**
   * 「上一轮那条 assistant」的落库身份（仅 ask_user 回答续写时传入）。续写要**写回同一条**
   * （原地替换）而非新建——渲染层传来的 `message` 是**主链 assistant 快照**（嵌套行在 UI 上
   * 合并进主链消息），既不含嵌套行 id、也无法据此定位落库行。由 `agent.ts` 下传以免再查库。
   */
  previousStored?: UIMessage
  /** 续写的子任务轮的 nest 判据（仅「续写到嵌套行」时有）⇒ 嵌套续写输入 = `[判据, 回答]`。 */
  continuationPrompt?: UIMessage
  /**
   * 本轮刚被回答的 ask_user `toolCallId`（由 `agent.ts` 精确回溯后下传）。
   *
   * 用于从渲染层快照中**只抽取这个回答 part**，而不是把整条快照当输入——后者会让子任务续写
   * 越权读整条主链（实测 `e2212cc1` ≈14.2 万 tokens）。未传时退回原行为（用整个 `message`）。
   */
  answeredToolCallId?: string
}

/**
 * 从渲染层送来的 assistant 快照里**只抽取**「刚被回答的那个 ask_user part」。
 *
 * `addToolOutput(toolCallId, output)` 把回答写在**主链 assistant** 快照上（嵌套行在 UI 上合并
 * 进主链消息），故快照 = 整条主链 + 回答。若整体当输入，子任务续写就越权读整条主链（见
 * `answeredToolCallId` 说明）。这里按 `toolCallId` 只留这一个 part，使输入 = 判据 + 回答。
 */
export function extractAnsweredPart(message: UIMessage, toolCallId: string): UIMessage['parts'] {
  return (message.parts ?? []).filter(
    (part) => (part as { toolCallId?: string }).toolCallId === toolCallId
  )
}

/**
 * 一轮落库的产出：
 * - `stored` ＝ 本轮产出的落库身份（供上层读 `totalProcessingMs` 等）；
 * - `reviewRowId` ＝ 变更卡片该挂哪一行（见 `locateCurrentRow`，恒有值）；
 * - `reviewRow` ＝ 该行**当前的落库内容基线**（卡片以它为底再追加/替换，见 `worker.saveReview`）。
 *
 * ⚠️ `reviewRow` 与 `stored` **不可混用**：嵌套轮二者是**两行**——`stored` 是嵌套行（带 `nested`
 * 标记、parts 为含嵌套私货的完整快照），`reviewRow` 是**主链行**（无 `nested`、只含主链 parts）。
 * 若用 `stored` 的内容配 `reviewRowId` 的 id 落库，会把「`nested` 标记 + 嵌套私货」写进主链行 ⇒
 * 主链助手行被 `loadMessages`（`nested IS NOT 1`）过滤而**永久消失**（实测回归：主链上下文由
 * `['u','main-anchor']` 变 `['u']`）。故两者必须成对、同源给出。
 */
export interface StoredRunResult {
  stored: UIMessage
  reviewRowId: string
  reviewRow: UIMessage
}

export async function runStoredAgentSession(
  sessions: SessionStore,
  request: AgentRequest
): Promise<StoredRunResult | undefined> {
  const { sessionId, cwd, message, options, onChunk, modelConfig } = request
  // 只对**内部 user 消息**（nest 判据 / compaction handoff）打 nested 标记：
  // 它们才是「不进主链上下文」的递归内部输入。
  // assistant 消息是 **UI 身份**——渲染层 `addToolOutput` 会把 ask_user 的回答追加到当前那条
  // assistant 上，其 `id` 与**主链 assistant 相同**。若给它也标 nested，`saveMessages` 的
  // `ON CONFLICT(session_id,id) DO UPDATE` 会用 `{id: 主链 id, nested:true}` **覆盖主链行**，
  // 而 `loadMessages` 会过滤 nested → 重启（从 DB 重载）后主链消息消失、对话错乱
  // （"有的消息没回复、有的等待回答却带完整回复"）。实测复现：子任务轮内的 ask_user 续写。
  const tag = (value: UIMessage): UIMessage =>
    request.nested && value.role === 'user' ? markNested(value) : value
  const text = message?.parts.find((part) => part.type === 'text')?.text.trim() ?? ''
  const shouldGenerateTitle =
    message !== undefined &&
    request.title === undefined &&
    !sessions.hasSession(sessionId) &&
    text.length >= 6

  // 用户不可见的工作流前缀：给**本轮用户新发的输入**打 `workflowPrefix` 标记并**落库保留**，
  // 使每次请求送给模型的文本一致（不破坏 prompt 缓存）。`toModelMessages` 据此在送给模型时
  // 拼上 `/agent_schedule_task `；text 保持原文，故 DB/UI/标题/搜索天然看不到前缀。
  // 排除：递归子任务轮（nested）、ask_user 回答（role=assistant）、compaction 续写。
  const isUserTurn =
    !request.nested &&
    message?.role === 'user' &&
    (message.metadata as Record<string, unknown> | undefined)?.compaction !== true
  const incoming: UIMessage | undefined =
    isUserTurn && message
      ? {
          ...message,
          metadata: {
            ...(message.metadata as Record<string, unknown> | undefined),
            workflowPrefix: true
          }
        }
      : message

  // 落库本轮输入消息（user 或 assistant 续写）；`undefined` 时不新增（防御性分支：
  // 编排层目前总会传入 message）。
  //
  // ⚠️ assistant 续写（ask_user 回答）**不能按渲染层给的 id 落库**：渲染层 `addToolOutput` 把回答
  // 写在**当前那条 UI assistant** 上，其 id 是**主链锚点 id**（AI SDK 复用），而其 parts 已把嵌套行
  // 内容**合并进来**。按该 id 落库会 `ON CONFLICT(session_id,id) DO UPDATE` **覆盖主链行**，把子任务
  // 内容+回答注入主链（实测：`main-anchor` N=2→5，`loadMessages` 因此越权读子任务）。故 assistant
  // 续写要**重定向到它真正该写的那条行**（= 承载者 `previousStored`，见 `locateCurrentRow` 第 1 条）。
  // 主链续写时 `previousStored.id` 恒等于渲染层 id ⇒ 重定向为恒等操作，行为不变。
  const incomingRow = request.previousStored
  const storedIncoming: UIMessage | undefined = incoming
    ? incoming.role === 'assistant' && incomingRow
      ? (incomingRow.metadata as Record<string, unknown> | undefined)?.nested === true
        ? markNested({ ...incoming, id: incomingRow.id })
        : { ...incoming, id: incomingRow.id }
      : tag(incoming)
    : undefined
  if (storedIncoming) {
    saveSessionMessages(sessions, sessionId, cwd, [storedIncoming], request.title)
  }
  const titleTask = shouldGenerateTitle
    ? generateSessionTitle(text, modelConfig)
        .then((title) => {
          if (!title) return
          sessions.renameSession(sessionId, title)
          request.onTitle?.(title)
        })
        .catch(() => {})
    : undefined
  // 递归子任务用全新上下文：只喂本轮 nest prompt，其余情况加载主链历史。
  //
  // 嵌套轮（nested）的输入 = `[本案判据?, 本轮输入]`：
  // - 判据（`continuationPrompt`）只在「续写的是一行**嵌套行**」时才有（见 `findAskUserContext`）；
  // - 本轮输入在 ask_user 续写时是**主链 assistant 快照**，需按 `answeredToolCallId` 只留回答 part，
  //   否则子任务续写会越权读整条主链；抽不到就退回原行为（不引入新失败路径）。
  const nestedInput = (): UIMessage[] => {
    const raw = message as UIMessage
    const answered = request.answeredToolCallId
      ? extractAnsweredPart(raw, request.answeredToolCallId)
      : []
    const current = answered.length ? { ...raw, parts: answered } : raw
    return request.continuationPrompt ? [request.continuationPrompt, current] : [current]
  }
  const messages =
    request.nested && message
      ? nestedInput()
      : await prepareMessages(sessions.loadMessages(sessionId))

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
  // UI 消息身份（`uiOriginalMessages`）与模型输入（`messages`）分离：AI SDK 靠「末条是 assistant
  // 就复用其 id」把本轮产出合并进那条 UI 消息。故末条要挂到渲染端**已有的** assistant 上——
  // 否则渲染端 replaceLastMessage 失败 ⇒ pushMessage 新建（并把锚点 parts 复制为基线）⇒ **UI 重复**。
  // 取值：reset 续写用 reset 前那条（时长跨段连续）；嵌套轮用渲染端**此刻的末端**。
  const continuationAnchor = request.nested ? request.previousStored : undefined
  // UI 锚点 = 渲染端此刻的末端 assistant（`lastVisibleAssistant`，**不过滤 nested**）；续写时用
  // 渲染端下传的落库身份 `previousStored`（它与渲染端末端一致、且是「该写回的那行」）。
  const nestedAnchor =
    continuationAnchor ??
    (request.nested && message ? sessions.lastVisibleAssistant(sessionId) : undefined)
  const uiOriginalMessages = continuationOf
    ? [...messages, continuationOf]
    : nestedAnchor
      ? [nestedAnchor]
      : undefined
  // 落库 id 的基**刻意取主链行**（`lastAssistant('after')` 过滤 nested ⇒ 恒主链行）：若用「上一轮
  // 嵌套行」，每轮会再挂一个后缀 ⇒ id 无限累积（实测会话 31b06fa6：60 → 588 字符）。
  const idAnchor = request.nested ? sessions.lastAssistant(sessionId, 'after') : undefined
  let latestStored: UIMessage | undefined
  // 本轮嵌套行的落库 id 后缀：每次 runStoredAgentSession 生成一次（轮内多次 saveResponse 复用
  // ⇒ 原地替换；跨轮各自不同 ⇒ 不互相覆盖）。续写轮不新建行，故无需后缀。
  const nestedSuffix = request.nested && !continuationAnchor ? randomUUID() : undefined
  // reset 续写轮的落库 id 重定向（见 `locateCurrentRow` 第 3 条路径）。
  const resetStoredId = isCompaction ? randomUUID() : undefined

  /**
   * **落库原语一：定位「本轮该写哪条行」**。返回 `id`（写进哪一行）、`nestedRow`（是否打
   * `nested` 标记）、`reviewRowId`（变更卡片挂哪一行——卡片只渲染主链消息，故嵌套轮的卡片必须
   * 回流到主链行）。四条路径（`*Anchor` 在非嵌套轮全为 undefined）：
   *
   * 1. **续写到既有行**（ask_user 回答续写）：原地替换 `previousStored`，保留其 id 与 nested 归属。
   * 2. **新一轮嵌套**：新建 `主链id-nested-<uuid>` 行。
   * 3. **reset 续写轮**：换成 `resetStoredId`。⚠️ **不可删**——reset 轮 `nested=false`，前两条
   *    都不命中；若删掉，产出会被写回 `continuationOf.id`（已被 `saveStart` 甩到 `start` 之前）
   *    ⇒ `loadMessages` 永远读不到 ⇒ 模型每轮重问（回归：`__reset-continuation-drop` 测试）。
   *    背景：AI SDK 把 reset 轮 id 定成 `continuationOf.id`（为让前端并进那条 UI 消息），
   *    `originalMessages`/UI 合并语义照旧，仅**落库**换 id 使其落在 `start` 之后可续写。
   * 4. **主链轮**：原样落库。
   */
  const locateCurrentRow = (
    response: UIMessage
  ): { id: string; nestedRow: boolean; reviewRowId: string; reviewRow: UIMessage } => {
    if (request.nested && continuationAnchor) {
      const nestedRow =
        (continuationAnchor.metadata as Record<string, unknown> | undefined)?.nested === true
      // 卡片目标：嵌套行的卡片回流到**主链行**（`idAnchor`）。其内容基线必须是**主链行本身**
      // （无 nested、只含主链 parts），不能用嵌套行的 `stored`（否则把 nested 标记与嵌套私货
      // 写进主链行、吞掉主链助手——见 `StoredRunResult` 警示）。恒等续写（主链行）时二者同一行。
      const stored = appendToRow(response, { id: continuationAnchor.id, nestedRow })
      return {
        id: continuationAnchor.id,
        nestedRow,
        reviewRowId: nestedRow ? (idAnchor?.id ?? continuationAnchor.id) : continuationAnchor.id,
        reviewRow: nestedRow ? (idAnchor ?? stored) : stored
      }
    }
    if (request.nested) {
      const id = nestedRowId(idAnchor, nestedSuffix)
      const stored = appendToRow(response, { id, nestedRow: true })
      // 卡片回流到主链行；基线取主链行本身（取不到才退回嵌套行，保证 `reviewRowId` 与
      // `reviewRow` 始终同源）。
      return {
        id,
        nestedRow: true,
        reviewRowId: idAnchor?.id ?? id,
        reviewRow: idAnchor ?? stored
      }
    }
    if (resetStoredId && response.id === continuationOf?.id) {
      const stored = { ...response, id: resetStoredId }
      return { id: resetStoredId, nestedRow: false, reviewRowId: resetStoredId, reviewRow: stored }
    }
    const stored = { ...response, id: response.id }
    return { id: response.id, nestedRow: false, reviewRowId: response.id, reviewRow: stored }
  }
  /**
   * **落库原语二：把本轮输出写入定位到的行**——只做「换 id / 打 nested 标记」，**不切片**。
   *
   * 落库行 = 完整的模型输出快照（`response.parts`）。旧实现按 `parts.slice(父轮.parts.length)`
   * 只存增量，但 AI SDK 对已有 part 是**按 toolCallId 原地改写**（`updateToolPart`），于是
   * 「用户回答 ask_user」表现为同一 part 原地变 `output-available`；按长度切片恰好把它切掉
   * ⇒ 已答问答配对永久消失（`#6843` 48→10 parts）。存完整快照即天然保留。嵌套行多存的 parts
   * 只占磁盘：`loadMessages` 只读主链行，不进模型输入。
   */
  const appendToRow = (response: UIMessage, row: { id: string; nestedRow: boolean }): UIMessage => {
    if (!row.nestedRow) return { ...response, id: row.id }
    return markNested({ ...response, id: row.id })
  }
  // 变更卡片的落库目标行（`worker.saveReview` 用）：行 id 与其**内容基线**由原语一并给出，
  // worker 不再自行推断（也就不会把嵌套行的内容写到主链行的 id 上）。
  let reviewRowId = ''
  let reviewRow: UIMessage | undefined
  const saveResponse = (response: UIMessage): void => {
    const row = locateCurrentRow(response)
    const stored = appendToRow(response, row)
    latestStored = stored
    reviewRowId = row.reviewRowId
    reviewRow = row.reviewRow
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
  // originalMessages 可能比 messages 长，AI SDK 把合并后的消息放在末尾 ⇒ 取末尾 assistant。
  const finalResponse = finalMessages.at(-1)
  if (finalResponse?.role === 'assistant') saveResponse(finalResponse)
  await titleTask
  return latestStored === undefined || reviewRow === undefined
    ? undefined
    : { stored: latestStored, reviewRowId, reviewRow }
}
