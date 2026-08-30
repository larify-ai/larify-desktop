import {
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage
} from 'ai'
import type { AssistantRenderItem } from '../message-render-items'

// 增量渲染 memo：渲染依赖内容比较。
// AI SDK 渲染端每个 chunk（throttle 50-100ms）都会对活跃消息做一层浅拷贝
//（@ai-sdk/react ReactChatState.snapshot：parts.map(p => ({...p}))），因此
// message / item 的对象引用每个 tick 都是新的，任何「按引用比较」的 memo 都会失效。
// 这里比较器只认渲染真正依赖的标量 + 内容长度（**零字符串分配**，与降 GC 目标一致），
// 已 settle 的项内容不变 → 复用上次结果跳过 reconcile；只有正在流式的尾部
// 项内容在变 → 仅重算该 item。方向是「增量」，不是把内容再折叠一层。

export interface ActivityGroupPartProps {
  item: AssistantRenderItem
  message: UIMessage
  streaming: boolean
  summaryIcon?: React.ReactNode
  summaryClassName?: string
  initialOpen?: boolean
  onOpenChange?: (open: boolean) => void
  additionalContent?: React.ReactNode
  contentOnly?: boolean
}

// 输出规模近似（只用长度，读取 O(1)，不做序列化）：
// string → 长度；array → 元素数；object → text 字段长度，否则数组字段元素数，否则键数。
// 覆盖常见工具输出（fs_read 字符串、fs_grep/terminal 数组、带 text 的对象）；
// 即使对象结构变化，长度近似也能区分「内容增长但 state 相同」。
export function outputSize(output: unknown): number {
  if (output == null) return 0
  if (typeof output === 'string') return output.length
  if (Array.isArray(output)) return output.length
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>
    const text = obj.text
    if (typeof text === 'string') return text.length
    const arrayField = Object.values(obj).find((value) => Array.isArray(value))
    return Array.isArray(arrayField) ? arrayField.length : Object.keys(obj).length
  }
  return 0
}

// 覆盖 item.partIndexes 指向的 parts 内容是否等价。
// indexes 已由 renderItemContentEquals 确认两棵树一致，这里直接逐项比较标量（零分配）。
// 为什么必须比较「内容长度」而不是只比 state：
//   工具输出/文本 streaming 期间 state 可能恒为 'streaming'，仅内容在增长；
//   若只比 state，展开的工具卡片/推理正文会因 memo 命中而不更新（stale）。
function partsContentEqual(a: UIMessage, b: UIMessage, indexes: number[]): boolean {
  for (const index of indexes) {
    const partA = a.parts[index]
    const partB = b.parts[index]
    if (!partA || !partB) {
      if (partA !== partB) return false
      continue
    }
    if (partA.type !== partB.type) return false
    const textPart =
      (isTextUIPart(partA) && isTextUIPart(partB)) ||
      (isReasoningUIPart(partA) && isReasoningUIPart(partB))
    if (textPart) {
      if (partA.state !== partB.state) return false
      if (partA.text.length !== partB.text.length) return false
    } else if (isToolUIPart(partA) && isToolUIPart(partB)) {
      if (partA.state !== partB.state) return false
      if (outputSize(partA.output) !== outputSize(partB.output)) return false
    }
  }
  return true
}

// renderItem 树内容比较（标量 + partIndexes + children 递归），不比较对象引用。
export function renderItemContentEquals(a: AssistantRenderItem, b: AssistantRenderItem): boolean {
  if (a === b) return true
  if (
    a.kind !== b.kind ||
    a.summary !== b.summary ||
    a.icon !== b.icon ||
    a.defaultOpen !== b.defaultOpen ||
    a.startedAt !== b.startedAt
  ) {
    return false
  }
  if (a.partIndexes.length !== b.partIndexes.length) return false
  for (let i = 0; i < a.partIndexes.length; i += 1) {
    if (a.partIndexes[i] !== b.partIndexes[i]) return false
  }
  const leftChildren = a.children
  const rightChildren = b.children
  if ((leftChildren?.length ?? 0) !== (rightChildren?.length ?? 0)) return false
  if (leftChildren && rightChildren) {
    for (let i = 0; i < leftChildren.length; i += 1) {
      if (!renderItemContentEquals(leftChildren[i], rightChildren[i])) return false
    }
  }
  return true
}

function totalProcessingMsOf(message: UIMessage): number {
  const metadata = message.metadata as Record<string, unknown> | undefined
  return typeof metadata?.totalProcessingMs === 'number' &&
    Number.isFinite(metadata.totalProcessingMs)
    ? metadata.totalProcessingMs
    : 0
}

// memo 比较器：只认渲染依赖（item 内容 + part 内容标量 + 标量 props），
// 不认 message/item 的浅拷贝引用。onOpenChange 闭包行为稳定（activityKey 固定），
// 忽略比较以避免 message-view 每 tick 新建箭头函数击穿 memo。
// 为什么还要比 totalProcessingMs：
//   分段复用消息时新一轮 run 的 start chunk 会写入 totalProcessingMs=previous，
//   它直接决定 LiveProcessingDuration 的 baseMs，漏掉会显示旧基数（时间不更新）。
export function activityGroupPropsEqual(
  previous: ActivityGroupPartProps,
  next: ActivityGroupPartProps
): boolean {
  if (previous === next) return true
  if (previous.streaming !== next.streaming) return false
  if (previous.summaryIcon !== next.summaryIcon) return false
  if (previous.summaryClassName !== next.summaryClassName) return false
  if (previous.initialOpen !== next.initialOpen) return false
  if (previous.additionalContent !== next.additionalContent) return false
  if (previous.contentOnly !== next.contentOnly) return false
  if (totalProcessingMsOf(previous.message) !== totalProcessingMsOf(next.message)) return false
  if (!renderItemContentEquals(previous.item, next.item)) return false
  return partsContentEqual(previous.message, next.message, previous.item.partIndexes)
}
