import type { UIMessage } from 'ai'

/**
 * 渲染前丢弃「相邻 assistant 副本」。
 *
 * 背景（见 `persist.ts` / `store.ts` 的落库身份设计，与 AI SDK 客户端的 replace/push 判据）：
 * 一次 `send()` 里，reset 的内部续写轮会发出**第二个 `start` chunk 且换新 id**（该新 id =
 * 落库的 `resetStoredId`——它必须落在 `sessions.start` 之后，否则模型读不到续写产出；这是
 * 「落库身份」，与「UI 身份」**有意解耦**）。而 AI SDK 客户端处理 `start` 时**只覆盖
 * `state.message.id`、不重置 `parts`** ⇒ 判据 `流 id === lastMessage.id` 变 false ⇒
 * `pushMessage` 出一条**仍带 reset 前全部 parts** 的副本 ⇒ live 期间同一批 progress/stage
 * 出现多遍（重载/重启从 DB 两条独立行重载即正常，因为库里**没有**超集行）。
 *
 * 这里在**渲染的唯咽喉**（`recentListItems` 入口）折叠掉这些副本：不依赖任何 id 对齐、
 * 同时覆盖 live 型与「历史库里遗留的副本行」，且**只改显示、不动数据**。
 *
 * ## 判据：相邻 assistant 里，谁被另一条**包含**就丢谁（对称）
 *
 * 副本的特征不是「id 相同」或「标题相同」，而是「**一条的 parts 是另一条的前缀**」；
 * 故两向都要折：
 * - **A**：后条 ⊇ 前条（前条是被包含的副本）⇒ 丢**前条**；
 * - **B**：后条 ⊂ 前条（后条是被包含的副本）⇒ 丢**后条**。
 *
 * 只保留**含它的那条**（超集）⇒ **零内容丢失**（它的每个 part 都已在那条里）。
 * 链式：`A ⊂ B ⊂ C` ⇒ 丢 A、B，留 C（单遍即可，见下）。
 *
 * ⚠️ 实现用 `isPartsPrefix`（**非严格**前缀：等长且逐签名相同也算）。等长 = 两条 parts 逐签名完全相同
 * ＝完全重复，A 分支会丢前条、留后条，结果正确。**实测全库 357 会话里「等长且逐签名相同」的相邻
 * assistant 对子 = 0**（同源只读脚本可比对），故「非严格」与「严格」在真实数据上**无差异**；
 * 保留非严格可顺带覆盖「整条完全相同」的重复。
 *
 * ## 两条护栏（只对 B 分支必要）
 *
 * - **① 在途 part**（`hasInFlightPart`）：丢了「正在等回答 / 正在流式输出」的那条行，主进程
 *   `agent.ts` 的 `findAskUserContext`（`state='input-available'` 且 `ORDER BY position DESC`）会
 *   命中它 ⇒ 回答与后续产出落进**看不见的行**。**仅在 B 分支需要**：A 分支丢的是前条，它的
 *   每个 part 都在保留的后条里（含同 `toolCallId` 的等待态），主进程照样能定位到保留行。
 * - **② 渲染端末端**（调用点传入的 `renderTailId`）：丢了渲染端末端，下一轮 `transport.ts` 的
 *   `uiTargetId` 仍指向它 ⇒ 产出写进看不见的行。**也只在 B 分支需要**：A 分支丢的是前条，
 *   而末端是最后一条 ⇒ 物理上不可能命中。
 *
 * 两条护栏在真实库里代价极小（实测 357 会话）：**护栏① 挡下 0 行**（67 个 A 可折行 + 11 个 B 短行
 * 全部不含在途 part）；**护栏② 挡下 2 行**（`f97e2d22#10836`、`d2820bdc#8058`，是渲染端末端）
 * ⇒ B 11 对 = **折入 9** + 护栏② 2 + 护栏① 0。
 *
 * ## 链的边界
 *
 * 只沿「相邻 assistant 链」比较：遇**真实用户消息**（非 compaction）即重置；中间的 compaction
 * user 行（reset 续写的分隔行）跳过。故跨轮的同名真实阶段（父轮「开始→需求」+ 子轮「开始→需求」）
 * 不受影响——它们不是前缀包含（子轮 parts 在中间夹入了父轮没有的内容）。
 */

/** part 的稳定签名。
 *
 * ⚠️ **必须带上内容**，不能只按 `type`：`reasoning`（与 `text`）parts 无 `toolCallId`、`type` 又相同，
 * 只按 type 会把「两条不同的回复」判成同一 part（实测误杀：nest 轮的 `[reasoning 'nested work']`
 * 被判成主链轮 `[reasoning 'main work']` 的超集 ⇒ 主链轮被丢弃）。签名取值：
 * - 工具调用：`toolCallId`（副本的每个 part 与源 part 的 `toolCallId` 逐字相同）；
 * - 文本：全文；- 推理：`id` + 全文；- 其余（`step-start` 等无内容 part）：`type`。
 */
function partSignature(part: UIMessage['parts'][number]): string {
  const candidate = part as { toolCallId?: string; type?: string; text?: string; id?: string }
  if (candidate.toolCallId) return `T:${candidate.toolCallId}`
  if (candidate.type === 'text') return `X:${candidate.text ?? ''}`
  if (candidate.type === 'reasoning') return `R:${candidate.id ?? ''}:${candidate.text ?? ''}`
  return `Y:${candidate.type}`
}

/** `prefix` 是否为 `whole` 的前缀（逐 part 签名相等）；空 `prefix` 不算前缀。 */
function isPartsPrefix(prefix: UIMessage['parts'], whole: UIMessage['parts']): boolean {
  if (prefix.length === 0 || whole.length < prefix.length) return false
  return prefix.every((part, index) => partSignature(part) === partSignature(whole[index]))
}

function isCompactionMessage(message: UIMessage | undefined): boolean {
  const metadata = message?.metadata as Record<string, unknown> | undefined
  return message?.role === 'user' && metadata?.compaction === true
}

/** 在途（尚未终态）part 的状态：持有它的行正在「等回答」或「流式输出」，不得被折叠隐藏。 */
const IN_FLIGHT_PART_STATES = new Set(['input-streaming', 'input-available', 'streaming'])

function hasInFlightPart(message: UIMessage): boolean {
  return (message.parts ?? []).some((part) => {
    const state = (part as { state?: unknown }).state
    return typeof state === 'string' && IN_FLIGHT_PART_STATES.has(state)
  })
}

/**
 * 丢掉「相邻 assistant 里被另一条严格包含」的副本，只留含它的那条（单遍 O(n)）。
 *
 * @param messages 渲染端此刻的消息序列（`recentListItems` 收到的最近窗口）。
 * @param renderTailId **护栏②**：渲染端末端的 id（= `messages.at(-1)?.id`）。它是下一轮
 *   `uiTargetId` 的落点，即使被包含也不折。由调用点传入——「谁算末端」是 UI 身份，不是内容判据。
 */
export function dedupeAssistantCopies(messages: UIMessage[], renderTailId?: string): UIMessage[] {
  const dropped = new Set<number>()
  // 单遍：沿链只记「最近一条 assistant」，遇真实 user 重置（compaction 行跳过）。
  // 与「每个 assistant 再向后扫第一条后继」的旧嵌套循环比较的**对子集合完全相同**（都是相邻
  // assistant 对子），故 A 方向的丢弃集合不变；B 方向为本次新增。
  let previous = -1
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'user') {
      if (!isCompactionMessage(message)) previous = -1
      continue
    }
    if (message.role !== 'assistant') continue
    const left = previous >= 0 ? messages[previous] : undefined
    if (left) {
      if (isPartsPrefix(left.parts ?? [], message.parts ?? [])) {
        dropped.add(previous)
      } else if (
        isPartsPrefix(message.parts ?? [], left.parts ?? []) &&
        !hasInFlightPart(message) &&
        message.id !== renderTailId
      ) {
        dropped.add(index)
      }
    }
    previous = index
  }
  return dropped.size > 0 ? messages.filter((_, index) => !dropped.has(index)) : messages
}
