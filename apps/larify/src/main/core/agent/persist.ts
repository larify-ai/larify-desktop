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
 * 去掉承载行里**所有未完成（`input-available`）的工具 part**，只留已完成的历史。
 *
 * 承载行是「历次 `saveResponse` 的累积快照」，会残留未完成的 tool part：本轮的等待态 `ask_user`
 * （由回答 part 顶替）、旧缺陷堆积的多个等待 ask（真实 `da3ad8bb#6921` 有 8 个）、以及任何
 * 执行中/被打断的工具。它们进 prompt 会变成「有 `tool-call` 无 `tool-result`」⇒ AI SDK 报
 * `Tool result(s) missing for tool call(s) …` 并**中断整个流**（见 `nested-continuation-dirty-data.test.ts`
 * 的 10 种形态矩阵）。已终态（`output-*`）保留 —— 它们是本嵌套轮历史的一部分。
 */
export function stripUnfinishedTools(parts: UIMessage['parts']): UIMessage['parts'] {
  return parts.filter((part) => {
    const p = part as { type?: string; state?: string }
    return !(p.type?.startsWith('tool-') && p.state === 'input-available')
  })
}

/** 两个 part 是否同一个工具调用（同非空 `toolCallId`）。 */
const sameCall = (a: UIMessage['parts'][number], b: UIMessage['parts'][number]): boolean => {
  const id = (b as { toolCallId?: string }).toolCallId
  return id !== undefined && (a as { toolCallId?: string }).toolCallId === id
}

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
  /**
   * **渲染端指定的「本轮输出应并入的 UI 消息 id」**（= 渲染端此刻的末端 assistant id）。
   *
   * 这是「UI 身份」的**唯一权威**：主进程据此设 `uiOriginalMessages`，使 AI SDK 的流 id 恒等于它，
   * 渲染端 `replaceLastMessage`（`流id === 自己的 lastMessage.id`）**必然成立** ⇒ 永远原地替换、
   * **物理上不可能新增副本**（消除「主进程猜渲染端末端 id」这一根因）。
   *
   * - 新提问轮：末条是 user ⇒ 渲染端给 `undefined` ⇒ 新建（AI SDK 自生成新 id）。
   * - ask_user 续写轮：`previousStored`（UI 上合并进的那条）的 id；因嵌套行在 UI 上合并进主链，
   *   该 id = **主链 id**，故主链续写与嵌套续写拿到的是同一个 id ⇒ 一致的 replace。
   * - **不传**（首轮无末端 / 旧渲染端）：完全回退现行为（`continuationOf`/`nestedAnchor` 反推）⇒
   *   向后兼容、可灰度。
   */
  uiTargetId?: string
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
 * 把「渲染层送来的、已终态的 ask_user part」**按 `toolCallId` 并入库内承载行**，作为 AI SDK 的
 * UI 合并基线（`originalMessages`）。
 *
 * 为什么必须补：渲染层 `addToolOutput` 只把回答写进**渲染层快照**；库内承载行的该 part 仍是
 * `input-available`。若直接拿库内行当基线，AI SDK 会以它的 parts 为基、只追加本轮增量 ⇒ 快照里
 * 「已回答（`output-available`）」的状态**被丢弃** ⇒ 承载行该 part 恒停 `input-available`，下一轮
 * 模型看不到「已答」而**再问一次**并追加新 ask ⇒ 同一行累积多个 `input-available`（用户感受
 * 「反复问同一个问题」）。实锤会话 `da3ad8bb#6921`（10 个 ask_user、8 个未落回）。
 *
 * 为什么不能直接把快照当基线：快照 id 与承载行一致、但 parts 是**整个主链 + 嵌套内容 + 回答**
 * 的合并视图，直接当基线会把子任务内容与回答注入主链行（越权污染主链，见 `locateCurrentRow`）。
 * 故只**按 toolCallId 取一个 part 覆盖**，行身份与其余 parts 保持库内原样。
 *
 * 不变量：仅当该 toolCallId 在渲染层快照里已处于终态（output-available / output-error）时覆盖，
 * 否则原样返回（不引入新失败路径）。
 */
export function withAnsweredTool(
  stored: UIMessage | undefined,
  from: UIMessage | undefined,
  toolCallId: string | undefined
): UIMessage | undefined {
  if (!stored || !from || !toolCallId) return stored
  const answered = (from.parts ?? []).find(
    (part) =>
      (part as { toolCallId?: string }).toolCallId === toolCallId &&
      (part as { state?: string }).state !== undefined &&
      (part as { state?: string }).state !== 'input-streaming' &&
      (part as { state?: string }).state !== 'input-available'
  )
  if (!answered) return stored
  const parts = stored.parts ?? []
  if (!parts.some((part) => (part as { toolCallId?: string }).toolCallId === toolCallId)) {
    return stored
  }
  return {
    ...stored,
    parts: parts.map((part) =>
      (part as { toolCallId?: string }).toolCallId === toolCallId ? answered : part
    )
  }
}

/**
 * 一轮落库的产出：
 * - `stored` ＝ 本轮产出的落库身份（供上层读 `totalProcessingMs` 等）；
 * - `reviewRowId` ＝ 变更卡片该挂哪一行（见 `locateCurrentRow`，恒有值）；
 * - `reviewRow` ＝ 该行**当前的落库内容基线**（卡片以它为底再追加/替换，见 `worker.saveReview`）；
 * - `uiMessageId` ＝ **本轮实际发给渲染层的 UI 消息 id**（= AI SDK 流里那条消息的 id）。
 *
 * ⚠️ `reviewRow` 与 `stored` **不可混用**：嵌套轮二者是**两行**——`stored` 是嵌套行（带 `nested`
 * 标记、parts 为含嵌套私货的完整快照），`reviewRow` 是**主链行**（无 `nested`、只含主链 parts）。
 * 若用 `stored` 的内容配 `reviewRowId` 的 id 落库，会把「`nested` 标记 + 嵌套私货」写进主链行 ⇒
 * 主链助手行被 `loadMessages`（`nested IS NOT 1`）过滤而**永久消失**（实测回归：主链上下文由
 * `['u','main-anchor']` 变 `['u']`）。故两者必须成对、同源给出。
 *
 * ⚠️ `uiMessageId` 与 `stored.id` **也可能不同**（reset 续写：落库换 `resetStoredId`、UI 仍是
 * `continuationOf.id`）——前者是「发给渲染层的身份」，后者是「写进库的身份」，两者解耦。
 * 用途：**新提问轮**由渲染端给 `undefined`，但该轮派生的 nest/reset 内部轮必须复用「本轮实际
 * 发给渲染层的 id」（= `uiMessageId`），否则那些内部轮退回「无 uiTargetId ⇒ 从 DB 猜」。
 */
export interface StoredRunResult {
  stored: UIMessage
  reviewRowId: string
  reviewRow: UIMessage
  uiMessageId: string
}

/**
 * `locateCurrentRow` 的产出：本轮该写的那条行（`stored`）及其 id/nested 归属与卡片目标行。
 *
 * `supersededId`：本轮**取代**掉的既有行 id（仅 reset 续写路径）。落库新行后应删除它——它承载的
 * 内容已被 `stored` **完整包含**（见 `locateCurrentRow` 第 3 条），留着就会与 `stored` 同时渲染
 * ⇒ 同一轮 progress 标题重复。作为**返回值显式给出**（而非跨调用的闭包状态），使"取代谁"与"写谁"
 * 同源、无时序耦合。
 */
interface LocatedRow {
  stored: UIMessage
  id: string
  nestedRow: boolean
  reviewRowId: string
  reviewRow: UIMessage
  supersededId?: string
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

  // 用户不可见的工作流前缀（「计划模式」）：渲染层仅在输入框打开计划模式开关时，才会在本轮用户消息上
  // 携带 `metadata.workflowPrefix: true`（见 composer）。此处**如实落库**该标记（不再无条件打标），
  // 使每次请求送给模型的文本一致（不破坏 prompt 缓存）。`toModelMessages` 据此在送给模型时拼上
  // `/follow_workflow `；text 保持原文，故 DB/UI/标题/搜索天然看不到前缀。默认关闭 ⇒ 不加前缀。
  //
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
  const storedIncoming: UIMessage | undefined = message
    ? message.role === 'assistant' && incomingRow
      ? (incomingRow.metadata as Record<string, unknown> | undefined)?.nested === true
        ? markNested({ ...message, id: incomingRow.id })
        : { ...message, id: incomingRow.id }
      : tag(message)
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
  // 递归子任务用全新上下文（只喂本轮 nest prompt），其余情况加载主链历史。
  // 嵌套轮的输入 = `[本案判据?, 本轮输入]`，而**本轮输入**按来源分三种：
  // ① 新建嵌套轮（判据轮）/ ③ 无回答 ⇒ 原样 `message`；
  // ② **ask_user 续写到嵌套行** ⇒ `[判据, 承载行的运行记录, 回答]`。
  //
  // ② 是本次修复点：旧行为只喂 `[判据, 回答]`，把承载行跑过的内容全丢了；而判据第 1 步就是
  // 「读 task.md、按 workflow 执行」⇒ 模型从起点**重跑**（实测 `c9ea2e13#7215` 全库 25 例）。
  // 数据源**必须是承载行**（主链之外 ⇒ 不越权；其 parts 是合法 step 序列，可直接喂 AI SDK）。
  const carried = request.nested ? request.previousStored : undefined
  const isNestedCarrier =
    carried !== undefined &&
    (carried.metadata as Record<string, unknown> | undefined)?.nested === true
  const answered =
    message && request.answeredToolCallId
      ? extractAnsweredPart(message, request.answeredToolCallId)
      : []
  const nestedInput = (): UIMessage[] => {
    const raw = message as UIMessage
    // ② 续写到嵌套承载行：`[承载行运行记录（去掉等待态的 ask_user）, 回答]`。
    // **不做截断**：承载行是「本嵌套轮的真实运行记录」，截它即丢历史（正是本修复要治的病）；
    // 且实测最坏情况（最长嵌套行 151 万字符 ⇒ ≈62 万 estTokens）**远低于模型可用输入上限**
    // （84 万）⇒ 请求仍能发出，只是会越过守门阈值 ⇒ 由通用守门（`prepareStep`）插提示让模型
    // reset —— 那正是守门的设计用途，无需在此另设预算。
    // 历史 = 承载行的运行记录（清掉未完成 part，否则会「有 call 无 result」而中断流）。
    // 拼接 = 历史 + 本轮回答（历史里已有同 toolCallId 时不重复追加）。
    const history = stripUnfinishedTools(carried?.parts ?? [])
    const parts =
      isNestedCarrier && answered.length
        ? [...history, ...answered.filter((a) => !history.some((h) => sameCall(h, a)))]
        : answered.length
          ? answered
          : raw.parts
    const current: UIMessage = { ...raw, parts }
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
  // ★ UI 身份的唯一权威：渲染端下传的 `uiTargetId`（= 渲染端此刻的末端 assistant id）。
  // 有它 ⇒ **不再**从 DB 反推（反推必错：reset 换库 id、nest 用主链 id ⇒ 猜错就 push 出副本）。
  // **id 恒取 `uiTargetId`**；**parts 取库内最佳代理**以保**时长累加基数**与 **AI SDK 合并基线**
  // （回答 part 的终态）：依次尝试 `findMessageById(uiTargetId)`（库里该 id 的行）→ `previousStored`
  // （渲染端快照）→ `lastVisibleAssistant`（reset 已用 `deleteBeforeStart` 删掉该行时的库内末端）。
  // 最后才退化成空 parts 占位（仅定 id）。**不可省 `lastVisibleAssistant` 那一档**——见其下注释。
  //
  // ⚠️ 续写到嵌套行时，库里那行的 ask_user part 仍 `input-available`，而用户回答只在渲染层快照
  // `message` 里（已 `output-available`）。必须先把「刚被回答的那个 part」按 `toolCallId` 并进基线，
  // 否则 AI SDK 以库内 parts 为基、只追加增量 ⇒ 回答被丢弃、该 part 恒停 `input-available`
  // ⇒ 下一轮重问（会话 `da3ad8bb#6921` 实测）。故统一用 `withAnsweredTool` 补一下。
  const uiTargetFromRenderer =
    request.uiTargetId === undefined
      ? undefined
      : withAnsweredTool(
          sessions.findMessageById(sessionId, request.uiTargetId) ??
            request.previousStored ??
            // ⚠️ **兜底不可省**：`findMessageById(uiTargetId)` 可能查不到——**reset 会用 `deleteBeforeStart`
            // 删掉被取代的旧行**，而渲染端仍持有那个 id（reset 轮是 `replaceLastMessage` 原地替换，id 不变）。
            // 此后本轮派生的 **nest 轮**复用同一 `uiTargetId` ⇒ 库里已无该行、又无 `previousStored`
            // ⇒ 若只退化成「空 parts 占位」，AI SDK 会以**空基线**克隆消息（`createStreamingUIMessageState`）
            // ⇒ 流出的 `state.message` 只含**本轮新增**、且 id 仍是渲染端那条 ⇒ 渲染端 `replaceLastMessage`
            // **原地替换**、把渲染端那条的既有内容**清空**（live 态内容丢失；实测：底座 0 parts、流出仅本轮）。
            // 故退化为「**库里此刻末端 assistant 的 parts**」（`lastVisibleAssistant`，不过滤 nested）——
            // 它正是渲染端此刻看到的合并内容（内容正确），仅 id 被换成渲染端权威的 `uiTargetId`（身份正确）。
            sessions.lastVisibleAssistant(sessionId),
          message,
          request.answeredToolCallId
        )
  // 有 `uiTargetId` ⇒ 一条权威：reset 续写挂到「模型输入 + uiTarget」（末尾 assistant ⇒ AI SDK 复用
  // 其 id）；其余轮直接以 `uiTarget` 为 UI 底座。缺省（无 `uiTargetId`）⇒ 完全回退现行为：
  // reset 续写用 reset 前那条（时长跨段连续）；嵌套轮用「渲染层此刻的末端 assistant」反推
  // （`lastVisibleAssistant`，**不过滤 nested**）。
  //
  // ⚠️ 回退路径（`withAnsweredTool` + `lastVisibleAssistant` 查询）**只在无 `uiTargetId` 时才求值**
  // ——有权威 id 时它是纯浪费（且 `lastVisibleAssistant` 的反推结果**不会被用到**）。
  const uiOriginalMessages = ((): UIMessage[] | undefined => {
    if (request.uiTargetId !== undefined) {
      // **id 恒取渲染端权威的 `uiTargetId`**（决定渲染端 replace/push），**parts 取库内最佳代理**
      // （决定 AI SDK 的合并基线 = 渲染端看到的内容）。二者来源可以不同：
      // - 命中 `findMessageById` ⇒ id/parts 都正确；
      // - 命中 `previousStored`（渲染端快照）⇒ id 换成 `uiTargetId`、parts 用快照；
      // - 命中 `lastVisibleAssistant`（reset 删行的兜底）⇒ id 换成 `uiTargetId`、parts 用库内末端；
      // - 全空（真无底座）⇒ 空 parts 占位（仅定 id）。
      const uiTarget: UIMessage = uiTargetFromRenderer
        ? { ...uiTargetFromRenderer, id: request.uiTargetId }
        : { id: request.uiTargetId, role: 'assistant', parts: [] }
      return continuationOf ? [...messages, uiTarget] : [uiTarget]
    }
    if (continuationOf) return [...messages, continuationOf]
    if (!request.nested || !message) return undefined
    const nestedAnchor =
      withAnsweredTool(continuationAnchor, message, request.answeredToolCallId) ??
      sessions.lastVisibleAssistant(sessionId)
    return nestedAnchor ? [nestedAnchor] : undefined
  })()
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
  const locateCurrentRow = (response: UIMessage): LocatedRow => {
    if (request.nested && continuationAnchor) {
      const nestedRow =
        (continuationAnchor.metadata as Record<string, unknown> | undefined)?.nested === true
      // 卡片目标：嵌套行的卡片回流到**主链行**（`idAnchor`）。其内容基线必须是**主链行本身**
      // （无 nested、只含主链 parts），不能用嵌套行的 `stored`（否则把 nested 标记与嵌套私货
      // 写进主链行、吞掉主链助手——见 `StoredRunResult` 警示）。恒等续写（主链行）时二者同一行。
      const stored = storedRow(response, { id: continuationAnchor.id, nestedRow })
      return {
        stored,
        id: continuationAnchor.id,
        nestedRow,
        reviewRowId: nestedRow ? (idAnchor?.id ?? continuationAnchor.id) : continuationAnchor.id,
        reviewRow: nestedRow ? (idAnchor ?? stored) : stored
      }
    }
    if (request.nested) {
      const id = nestedRowId(idAnchor, nestedSuffix)
      // **只存本轮增量**：AI SDK 以 `nestedAnchor`（= 上一轮嵌套行）为基线克隆其全部 parts，
      // 流式过程中只**追加**本轮新增（新建路径是纯追加，实测 response.parts 头部逐字节等于
      // `nestedAnchor.parts`）⇒ 从基线长度起切即得本轮增量。
      //
      // 为何不重蹈旧 `parts.slice(父轮.parts.length)` 的坑：旧实现**无差别**切片，把「原地改写」
      // 的 ask_user 回答也切掉（该 part 长度不变、内容变 ⇒ 切片恰好丢弃）。而 ask 回答走的是
      // **续写路径**（第 1 条，`continuationAnchor` 分支，不切片）；本分支是「模型产出新轮」的
      // 纯追加，切掉的恰是「基线里已有的旧 part」——它们已在上一轮的行里、本轮无需重复存。
      //
      // 不切会怎样：新行 = 基线全部 parts + 本轮增量 ⇒ 每轮复制一份历史（实测真实会话
      // `825617b9` 子任务链 12 轮行体积 38K→333K tokens 单调膨胀）。`loadMessages` 只读主链行，
      // 故只占磁盘、不进模型输入，但长任务会持续膨胀并最终逼近守门阈值。
      //
      // ⚠️ **切片基准必须 = AI SDK 的流式基线**（= `uiOriginalMessages.at(-1)`），否则切片长度取错：
      // AI SDK 以 `uiOriginalMessages` 末条为基线克隆其全部 parts（见 `session.ts` 的
      // `createUIMessageStream({ originalMessages })`）。有 `uiTargetId` 时基线是**渲染端权威**的
      // `uiTarget`，而非 DB 反推的 `nestedAnchor`——多轮嵌套链里二者不同（`nestedAnchor` = 上一嵌套行,
      // `uiTarget` = 主链行）⇒ 按 `nestedAnchor` 切会**丢掉本轮输出**（实测：应存 5 parts，实存 2）。
      const stored = storedRow(response, {
        id,
        nestedRow: true,
        sliceFrom: uiOriginalMessages?.at(-1)
      })
      // 卡片回流到主链行；基线取主链行本身（取不到才退回嵌套行，保证 `reviewRowId` 与
      // `reviewRow` 始终同源）。
      return {
        stored,
        id,
        nestedRow: true,
        reviewRowId: idAnchor?.id ?? id,
        reviewRow: idAnchor ?? stored
      }
    }
    if (resetStoredId) {
      const stored = { ...response, id: resetStoredId }
      // reset 续写**换新 id**（使其落在 `sessions.start` 之后、可被 `loadMessages` 读到），于是本轮
      // 产出会**新建一行**，而 reset 前那条旧行（`continuationOf`）留在库里。旧行已被新行**完整包含**
      // （AI SDK 以它为基线克隆全部 parts + 追加增量；实测旧行每个 part 都在新行里）且落在 `start`
      // 之前 ⇒ 模型输入不需要它；但 `loadVisibleMessages` 会把两条**同时渲染** ⇒ 同一轮回复里的
      // progress 标题各出现多遍（真实会话 `7a2df69b`）。故：**用新版本取代旧行**。
      //
      // ⚠️ **判据不得依赖 `response.id === continuationOf?.id`**（旧写法）：解 A 后 `uiOriginalMessages`
      // 末条是渲染端权威的 `uiTargetId`（见上），AI SDK 令 `response.id = uiTargetId`。**首次 reset 时
      // `uiTargetId` 恰 = `continuationOf.id`**（渲染端末端就是 reset 前那条 assistant）故能命中；
      // 但**第二次 reset 时**（同一会话内 reset 两次）`continuationOf` 是**上一轮 reset 新行**
      // （`resetStoredId`），而 `uiTargetId` 仍是渲染端那条 **旧 id** ⇒ 二者不等 ⇒ 旧判据落空
      // ⇒ 产出被写回 `response.id`（= 渲染端旧 id，其库内行**已被上一轮 `deleteBeforeStart` 删掉**）
      // ⇒ **新行与上一轮 reset 行同时可见 ⇒ 同一轮 UI 重复复发**（实测：可见 assistant 行 2 条）。
      // reset 轮的唯一可靠标志是 `resetStoredId`（由 `isCompaction` 决定）——与 id 来源无关。
      // `continuationOf` 可能为空（首次 reset 前无 assistant）⇒ 此时无行可取代。
      return {
        stored,
        id: resetStoredId,
        nestedRow: false,
        reviewRowId: resetStoredId,
        reviewRow: stored,
        ...(continuationOf ? { supersededId: continuationOf.id } : {})
      }
    }
    const stored = { ...response, id: response.id }
    return {
      stored,
      id: response.id,
      nestedRow: false,
      reviewRowId: response.id,
      reviewRow: stored
    }
  }
  /**
   * **落库原语二：由「本轮模型输出 + 定位到的行」算出该行要落库的内容**——换 id、打 nested
   * 标记，并按需**只取本轮增量**。
   *
   * `sliceFrom` 指定「基线行」：给出时只存 `response.parts.slice(基线.parts.length)`（本轮增量）。
   * 仅在**新建嵌套行**路径使用——那里模型输出是「基线克隆 + 纯追加」，切片安全；续写路径
   * （`continuationAnchor`）**不传** `sliceFrom`，因 AI SDK 会对已有 part **按 toolCallId 原地
   * 改写**（`updateToolPart`），「用户回答 ask_user」表现为同一 part 原地变 `output-available`，
   * 按长度切片会把它切掉 ⇒ 问答配对永久消失（旧 bug，实测 `#6843` 48→10 parts）。
   */
  const storedRow = (
    response: UIMessage,
    row: { id: string; nestedRow: boolean; sliceFrom?: UIMessage }
  ): UIMessage => {
    const parts = row.sliceFrom ? response.parts.slice(row.sliceFrom.parts.length) : response.parts
    const base = { ...response, parts, id: row.id }
    return row.nestedRow ? markNested(base) : base
  }
  // 变更卡片的落库目标行（`worker.saveReview` 用）：行 id 与其**内容基线**由原语一并给出，
  // worker 不再自行推断（也就不会把嵌套行的内容写到主链行的 id 上）。
  let reviewRowId = ''
  let reviewRow: UIMessage | undefined
  const saveResponse = (response: UIMessage): void => {
    const row = locateCurrentRow(response)
    latestStored = row.stored
    reviewRowId = row.reviewRowId
    reviewRow = row.reviewRow
    sessions.saveMessages(sessionId, [row.stored])
    // reset 续写换新 id 落库后，用新版本**取代**旧行（其内容已被 `stored` 完整包含，见 `LocatedRow`）。
    if (row.supersededId !== undefined) sessions.deleteBeforeStart(sessionId, row.supersededId)
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
  if (latestStored === undefined || reviewRow === undefined) return undefined
  // 本轮**实际发给渲染层的 UI id**：
  // - 有 `uiTargetId`（渲染端指定 / 本链内部轮复用）⇒ 就是它；
  // - 否则（新提问轮）⇒ AI SDK 自生成的新 id，即 UI 底座的 id（无底座时取末条产出 id）。
  // 供编排层在该轮派生的 nest/reset 内部轮**复用**（它们是同一条 UI 消息的连续产出）。
  const uiMessageId =
    request.uiTargetId ??
    (uiOriginalMessages?.at(-1)?.role === 'assistant'
      ? (uiOriginalMessages.at(-1) as UIMessage).id
      : finalResponse?.id) ??
    latestStored.id
  return { stored: latestStored, reviewRowId, reviewRow, uiMessageId }
}
