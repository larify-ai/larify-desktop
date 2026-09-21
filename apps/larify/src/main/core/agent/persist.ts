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

/**
 * 把「嵌套轮的一轮模型输出」换算为**应落库**的独立行。
 *
 * 嵌套轮 AI SDK 返回的是**合并消息**：`value.parts` = 父轮已存行的 parts + 子轮增量，
 * `value.id` = UI 身份锚点 id。若按原值落库会「用嵌套标记覆盖主链行」或「把整段累积写成一行」，
 * 故这里**只取增量、并换一个独立的 `-nested-<uuid>` id**（不覆盖主链行、且各轮互不覆盖）。
 *
 * 两个基准**刻意分离**——它们的需求相反，混用会各自出错（会话 31b06fa6 实证）：
 * - `sliceBase`（切片基准）＝ **父轮已存行**（UI 锚点，可能缺失/不可读）。`parts.slice(base.length)`
 *   得子轮增量；`sliceBase` 为 `undefined` 时视为「非嵌套轮」，直接交给 `tag`（原样落库）。
 * - `idBase`（id 基准）＝ **主链行**（稳定不变），故每轮 id 恒为 `主链id-nested-<uuid>`；
 *   若误用「上一轮嵌套行」作基准，后缀会层层叠加（实测 id 从 60 涨到 588 字符）。
 *
 * 调用方（`toStored`）保证：**嵌套轮必传非空 `sliceBase`**（锚点缺失时用空基准），
 * 因此嵌套轮的 assistant **恒** `markNested` + 切片，绝不原样泄漏进主链上下文
 * （旧实现 `!anchor` 时原样返回 ⇒ 巨行无 `nested` 标记落库，见会话 31b06fa6 的 `#6518`）。
 */
export function nestStoredMessage(
  value: UIMessage,
  tag: (value: UIMessage) => UIMessage,
  sliceBase: UIMessage | undefined,
  idBase: UIMessage | undefined,
  suffix?: string
): UIMessage {
  // 无切片基准 ⇒ 非嵌套轮：原样（仅可选打 nested 标记由 tag 决定）。
  if (!sliceBase) return tag(value)
  return markNested({
    ...value,
    // 后缀**每轮唯一**：多轮嵌套会因 `ON CONFLICT(session_id,id) DO UPDATE` 互相覆盖
    // （实测判据行堆到 18+ 条、assistant 仅 1 条）；同一轮内多次 saveResponse 复用同一 suffix
    // 保证仍原地替换而非新增行。
    id: `${idBase?.id ?? sliceBase.id}-nested-${suffix ?? 'x'}`,
    // 只存「父轮已存行」之后的增量。
    parts: value.parts.slice(sliceBase.parts.length)
  })
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
   * （原地替换），而非新建——渲染层传来的 `message` 是**主链 assistant**的快照（nested 行在
   * UI 上合并进主链消息），故它既不携带嵌套行的 id、也无法据此推算增量切片基准。
   * 由 `agent.ts` 在 `resumed` 分支从 `lastMessage()` 读出后下传，避免 persist 再查一次库。
   */
  previousStored?: UIMessage
  /**
   * ask_user 回答续写时，该**子任务轮**的 nest 判据（由 `agent.ts` 按 toolCallId 精确回溯下传）。
   * 有值时，嵌套续写的模型输入 = `[判据, 回答]`——「从该子任务轮继续」，而不是「只有回答」。
   */
  continuationPrompt?: UIMessage
}

export async function runStoredAgentSession(
  sessions: SessionStore,
  request: AgentRequest
): Promise<UIMessage | undefined> {
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
  if (incoming) {
    saveSessionMessages(sessions, sessionId, cwd, [tag(incoming)], request.title)
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
  // 递归子任务用全新上下文：只喂本轮 nest prompt，不带最上层与其它子任务的消息。
  // 跨层信息只经 task.md 传递（见 nest/prompt.md 生成的判据）。其余情况（主链续跑）加载主链历史。
  //
  // ask_user 回答续写（nested）例外：渲染层送来的 `message` 只是「回答」，不含任务背景。
  // 若 `continuationPrompt`（该子任务轮的 nest 判据）可得，则本轮输入 = `[判据, 回答]`——
  // 让模型**从该子任务轮继续**（判据恢复任务语境，回答是新增输入），而不是只看到孤立回答。
  const messages =
    request.nested && message
      ? request.continuationPrompt
        ? [request.continuationPrompt, message]
        : [message]
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
  // UI 消息身份（originalMessages）与模型输入（messages）分离：
  // - reset 续写：并入 reset 前 assistant，末尾是 assistant → AI SDK 复用其 id 合并成一条。
  // - 递归子任务轮次：模型输入是独立上下文 [nest prompt]，但 UI 身份要挂在**主链最后一条
  //   assistant** 上。否则渲染端 AI SDK 的 Chat 会为该轮新建一条 assistant 消息（messageId
  //   与客户端已有的主链 assistant 不同 → replaceLastMessage 失败 → pushMessage），且新消息
  //   以主链 assistant 的全部 parts 为起点再追加子轮 parts → **UI 出现重复的父轮阶段**。
  //   传入 [lastMainAssistant]（末尾是 assistant）后，AI SDK 会给流内 start chunk 盖上该
  //   assistant 的 id，渲染端据此复用并合并成一条。模型输入 messages 不变。
  // 锚点（UI 身份 + 落库切片基准）取值，两条路径：
  // - **续写**（ask_user 回答经 addToolOutput 再 send）：锚点是**上一轮那条 assistant 的落库身份**，
  //   由 agent.ts 的 resumed 分支从 lastMessage 读出后下传（request.previousStored）。
  //   它可能是**嵌套行**（`-nested-<suffix>`）→ 续写须原地替换该行（复用 id、只存增量、保留 nested）；
  //   也可能是**主链行**（主链轮里的续写）→ 原样落库。
  //   不能用 message 自身代替：渲染层传来的是**主链 assistant 的快照**（嵌套行在 UI 上合并进
  //   主链消息），既不含嵌套行 id、也推不出增量切片基准。
  //   也不能退回 lastAssistant('after')：它过滤 nested → 只能拿到主链行 → 续写被当成新的一轮
  //   嵌套、落成新 id → UI 多出一条（实测：子任务轮 ask_user 回答后消息重复）。
  // - **新一轮嵌套**（nest 判据）：取**渲染层此刻的末端 assistant** 作 UI 锚点。
  //   必须用 `lastVisibleAssistant`（**不过滤 nested**）：渲染层把嵌套行也当普通 assistant 持有，
  //   故「上一轮是嵌套轮」时末端就是那条 `-nested-<uuid>` 行。若退回 `lastAssistant('after')`
  //   （过滤 nested ⇒ 恒返回主链行），锚点 id 与渲染层末端不一致 ⇒ 客户端 `pushMessage`（新建）
  //   并把锚点全部 parts 复制为基线 ⇒ **UI 整段内容重复**（实测：第二个及以后的嵌套轮；
  //   首个嵌套轮因末端恰好还是主链行而看不出问题）。
  const continuationAnchor = request.nested ? request.previousStored : undefined
  const nestedAnchor =
    continuationAnchor ??
    (request.nested && message ? sessions.lastVisibleAssistant(sessionId) : undefined)
  // **落库 id 的基**：主链行（`lastAssistant('after')` 过滤 nested ⇒ 恒主链行）。它与 UI 锚点
  // `nestedAnchor`（= 渲染层末端，可能是上一轮嵌套行）**刻意分离**：
  // - UI 身份必须用 `nestedAnchor`，否则渲染端 `pushMessage` 新建 ⇒ UI 整段重复；
  // - id 必须用**主链行**，否则每轮在上一轮嵌套 id 上再挂后缀 ⇒ id 无限累积
  //   （实测会话 31b06fa6：`#6496→#6520` 从 60 涨到 588 字符）。
  const idAnchor = request.nested ? sessions.lastAssistant(sessionId, 'after') : undefined
  const uiOriginalMessages = continuationOf
    ? [...messages, continuationOf]
    : nestedAnchor
      ? [nestedAnchor]
      : undefined
  // 统一的落库入口：把「模型输出」换算为**落库身份**（nested 轮次即「增量 + 新 id」那条）后入库，
  // 并记下最近一次的身份——返回给 worker 的变更快照回写（saveReview）在同一身份上原地替换，
  // 避免把快照写到主链 anchor 行上。
  let latestStored: UIMessage | undefined
  // 本次 nest 轮的落库 id 后缀：**每次 runStoredAgentSession 生成一次**，本轮内多次
  // saveResponse（每个 step 结束时）复用同一值 → 原地替换；跨轮（回父/重入/续写）各自
  // 不同 → 不再互相覆盖。续写轮不新建行，故无需后缀。
  const nestedSuffix = request.nested && !continuationAnchor ? randomUUID() : undefined
  // 续写锚点是否为「嵌套行」（UI 私有的增量行）——决定续写落库时是否切片 + 保留 nested。
  const isNestedRow = (value: UIMessage | undefined): boolean =>
    (value?.metadata as Record<string, unknown> | undefined)?.nested === true
  // reset 续写轮的**落库 id 重定向**：AI SDK 会把本轮消息 id 定成 `continuationOf.id`
  // （`originalMessages` 末条是 assistant ⇒ 复用其 id），以便前端把产出**并进那条 UI 消息**
  // （`handleUIMessageStreamFinish`）。但 `continuationOf` 已被 `saveStart` 甩到
  // `sessions.start` **之前**——若原样落库，本轮产出的新 ask_user 也写进它，
  // 而 `loadMessages`（只读 `position >= start`）永远读不到 ⇒ 模型每轮都像第一次一样重问、
  // 用户的回答永远进不了模型（现场会话 91c9b81b：一次 reset 污染其后全部 4 轮）。
  //
  // 修法：**UI 身份与落库身份分离**（与嵌套行既有的 `idAnchor`/`nestedAnchor` 拆分同构）——
  // `originalMessages` 照旧（UI 合并、时长连续都不变），仅把**落库**换成一个新 id，
  // 使其落在 `start` 之后、成为新段里第一条可续写的 assistant 行。
  const resetStoredId = isCompaction ? randomUUID() : undefined
  /**
   * 把「本轮模型输出」换算为**落库身份**：
   * - reset 续写轮（非 nested）：换新 id 落库（见上方说明），UI 身份不变。
   * - 续写到嵌套行：原地替换（复用其 id、只存增量、保留 nested）。
   * - 续写到主链行：**原样落库**（它是主链 UI 消息，切片/标 nested 都会破坏主链）。
   * - 其余嵌套轮：增量 + 以**主链行**为基的新 id（避免覆盖主链行、且 id 不累积）。
   * - 非嵌套轮：原样。
   *
   * 关键：嵌套轮的 `sliceBase` 即使取不到（`nestedAnchor=undefined`）也**不退回原样落库**——
   * 用一个空基准代替，仍会 `markNested` + 切片（整段），从而**绝不泄漏进主链上下文**
   * （旧实现 `!anchor` 时原样返回 ⇒ 巨行无 `nested` 标记落库，见会话 31b06fa6 的 `#6518`）。
   */
  const toStored = (response: UIMessage): UIMessage => {
    if (!request.nested) {
      // reset 续写轮：只在**首次**落库时换 id；同一轮内多次 saveResponse 复用同一 id
      // （原地更新，不产生多行）。
      if (resetStoredId && response.id === continuationOf?.id) {
        return { ...response, id: resetStoredId }
      }
      return response
    }
    if (continuationAnchor) {
      if (!isNestedRow(continuationAnchor)) return response
      return markNested({
        ...response,
        id: continuationAnchor.id,
        parts: response.parts.slice(continuationAnchor.parts.length)
      })
    }
    // 新一轮嵌套：切片基准＝UI 锚点（缺则空基准⇒整段）；id 基＝主链行。
    const sliceBase = nestedAnchor ?? { ...response, parts: [] }
    return nestStoredMessage(response, tag, sliceBase, idAnchor, nestedSuffix)
  }
  const saveResponse = (response: UIMessage): void => {
    const stored = toStored(response)
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
