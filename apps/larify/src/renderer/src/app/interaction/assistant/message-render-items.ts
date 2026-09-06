import { getToolName, isFileUIPart, isToolUIPart, type UIMessage } from 'ai'
import { isVisibleToolPart } from './message-parts/tool-visibility'
import { formatProcessingDuration, formatProcessingDurationMs } from './processing-duration'

export type AssistantRenderItemKind =
  | 'final-text'
  | 'status'
  | 'reasoning'
  | 'intermediate-text'
  | 'tool-group'
  | 'activity-group'
  | 'pending-ask-user'

export interface AssistantRenderItem {
  kind: AssistantRenderItemKind
  partIndexes: number[]
  summary: string
  defaultOpen: boolean
  icon?: string
  children?: AssistantRenderItem[]
  startedAt?: number
}

interface LifecycleMetadata {
  startedAt?: unknown
  completedAt?: unknown
  outcome?: unknown
  totalProcessingMs?: unknown
  error?: unknown
}

function lifecycleMetadata(message: UIMessage): LifecycleMetadata {
  return (message.metadata ?? {}) as LifecycleMetadata
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isInterrupted(metadata: LifecycleMetadata): boolean {
  return metadata.outcome === 'aborted' || metadata.outcome === 'error'
}

function hasValidDuration(
  metadata: LifecycleMetadata
): metadata is LifecycleMetadata & { startedAt: number; completedAt: number } {
  return (
    isFiniteNumber(metadata.startedAt) &&
    isFiniteNumber(metadata.completedAt) &&
    metadata.completedAt >= metadata.startedAt
  )
}

export function isActivityRenderItem(item: AssistantRenderItem): boolean {
  return item.kind !== 'final-text' && item.kind !== 'pending-ask-user'
}

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
const summaryPrefixLimit = 320

// summary 只是一行截断的纯文本预览（<span class="truncate">），不渲染成 markdown DOM，
// 因此无需 fromMarkdown 建 AST。这里只做轻量字符串剥离常见 md 可视符号，让预览干净。
function textSummary(text: string): string {
  const plain = text
    .slice(0, summaryPrefixLimit)
    .replace(/<!--[\s\S]*?-->/g, '') // HTML 注释
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // ATX 标题
    .replace(/```[\s\S]*?```/g, ' ') // 代码块（整块仅留一个空格）
    .replace(/`([^`]+)`/g, '$1') // 行内代码
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接 [text](url) -> text
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 粗体 **x**
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+/gm, '') // 列表项 - / 1.
    .replace(/\s+/g, ' ')
    .trim()
  const first = sentenceSegmenter.segment(plain)[Symbol.iterator]().next()
  return first.done ? plain : first.value.segment.trim()
}

export function hasVisibleTextPart(part: UIMessage['parts'][number]): boolean {
  return (part.type === 'text' || part.type === 'reasoning') && part.text.trim().length > 0
}

function toolTitle(
  part: Extract<UIMessage['parts'][number], { type: `tool-${string}` | 'dynamic-tool' }>
): string {
  const input = part.input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const title = (input as Record<string, unknown>).toolCallTitle
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
  return getToolName(part)
}

function isPendingAskUser(
  part: UIMessage['parts'][number],
  superseded = false
): boolean {
  return (
    !superseded &&
    isToolUIPart(part) &&
    getToolName(part) === 'agent_ask_user' &&
    part.state === 'input-available'
  )
}

export function pendingAskUserIndex(message: UIMessage, superseded = false): number {
  // 在"最后一个 step-start 之后"的范围内查找第一个可见的待回答 ask_user，
  // 而非只看"最后一个可见工具是不是 ask_user"。原因：模型在同一 step 并行调用
  // ask_user 与其他工具（如 fs_list）时，最后一个可见工具是 fs_list，ask_user 会被
  // 误判为"非等待回答" → 顶部显示"已完成"且 ask_user 卡片被折叠不可见。
  // 限定在最后一个 step-start 之后以排除历史 step 的旧提问；
  // isVisibleToolPart + isPendingAskUser 排除隐藏(raw)与已 superseded(用户发新消息跳过)的 ask_user。
  const lastStepStartIndex = message.parts.findLastIndex((part) => part.type === 'step-start')
  return message.parts.findIndex(
    (part, index) =>
      index > lastStepStartIndex &&
      isToolUIPart(part) &&
      isVisibleToolPart(part) &&
      isPendingAskUser(part, superseded)
  )
}

function toolIcon(part: UIMessage['parts'][number]): string | undefined {
  if (!isToolUIPart(part)) return undefined
  const icon = (part.toolMetadata as { icon?: unknown } | undefined)?.icon
  return typeof icon === 'string' ? icon : undefined
}

function completedSummary(metadata: LifecycleMetadata, waitingForAnswer: boolean): string {
  const interrupted = isInterrupted(metadata)
  const status = interrupted ? '已中断' : waitingForAnswer ? '等待回答' : '已完成'
  // error 时透出原因（截断到一行），便于用户/开发者定位"为什么提前结束"。
  const errorReason =
    metadata.outcome === 'error' && typeof metadata.error === 'string' && metadata.error.trim()
      ? ` · ${metadata.error.trim().slice(0, 160)}`
      : ''
  if (isFiniteNumber(metadata.totalProcessingMs)) {
    return `${status}${errorReason} · ${formatProcessingDurationMs(metadata.totalProcessingMs)}`
  }
  if (hasValidDuration(metadata)) {
    return `${status}${errorReason} · ${formatProcessingDuration(metadata.startedAt, metadata.completedAt)}`
  }
  return interrupted || waitingForAnswer ? `${status}${errorReason}` : '处理过程'
}

export function buildAssistantRenderItems(
  message: UIMessage,
  streaming: boolean,
  superseded = false
): AssistantRenderItem[] {
  if (message.role !== 'assistant') return []

  const metadata = lifecycleMetadata(message)
  const interrupted = isInterrupted(metadata)
  const visibleIndexes: number[] = []
  const stepByPartIndex: number[] = []
  let step = 0
  message.parts.forEach((part, index) => {
    if (part.type === 'step-start') step += 1
    stepByPartIndex[index] = step
    if (isFileUIPart(part)) return
    if (hasVisibleTextPart(part)) {
      visibleIndexes.push(index)
    } else if (isToolUIPart(part) && isVisibleToolPart(part)) {
      visibleIndexes.push(index)
    }
  })
  const lastStepStartIndex = message.parts.findLastIndex((part) => part.type === 'step-start')
  const lastStepActivityIndex = message.parts.findLastIndex(
    (part, index) => index > lastStepStartIndex && (part.type === 'reasoning' || isToolUIPart(part))
  )
  const directTextStartIndex = Math.max(lastStepStartIndex, lastStepActivityIndex)
  const canRenderFinalText = !interrupted && !streaming
  const trailingTextParts = canRenderFinalText
    ? message.parts.flatMap((part, index) =>
      part.type === 'text' && index > directTextStartIndex ? [{ index, text: part.text }] : []
    )
    : []
  const firstVisibleFinalTextIndex = trailingTextParts.find(({ text }) => text.trim())?.index
  const items: AssistantRenderItem[] = []
  const pendingAskIndex = interrupted ? -1 : pendingAskUserIndex(message, superseded)
  const waitingForAnswer = pendingAskIndex >= 0

  for (let offset = 0; offset < visibleIndexes.length; offset += 1) {
    const partIndex = visibleIndexes[offset]
    const part = message.parts[partIndex]
    if (!part) continue

    if (canRenderFinalText && part.type === 'text' && partIndex > directTextStartIndex) {
      if (partIndex !== firstVisibleFinalTextIndex) continue
      items.push({
        kind: 'final-text',
        partIndexes: trailingTextParts.map(({ index }) => index),
        summary: '',
        defaultOpen: true
      })
      continue
    }
    if (part.type === 'reasoning') {
      items.push({
        kind: 'reasoning',
        partIndexes: [partIndex],
        summary: textSummary(part.text),
        defaultOpen: false
      })
      continue
    }
    if (part.type === 'text') {
      items.push({
        kind: 'intermediate-text',
        partIndexes: [partIndex],
        summary: textSummary(part.text),
        defaultOpen: false
      })
      continue
    }
    if (!isToolUIPart(part)) continue
    if (partIndex === pendingAskIndex && isPendingAskUser(part, superseded)) {
      items.push({
        kind: 'pending-ask-user',
        partIndexes: [partIndex],
        summary: toolTitle(part),
        defaultOpen: true
      })
      continue
    }

    const partIndexes = [partIndex]
    const titles = [toolTitle(part)]
    const icon = toolIcon(part)
    while (offset + 1 < visibleIndexes.length) {
      const nextIndex = visibleIndexes[offset + 1]
      const nextPart = message.parts[nextIndex]
      if (
        !nextPart ||
        !isToolUIPart(nextPart) ||
        isPendingAskUser(nextPart, superseded) ||
        toolIcon(nextPart) !== icon ||
        stepByPartIndex[nextIndex] !== stepByPartIndex[partIndex]
      ) {
        break
      }
      partIndexes.push(nextIndex)
      titles.push(toolTitle(nextPart))
      offset += 1
    }
    items.push({
      kind: 'tool-group',
      partIndexes,
      summary: titles.join('、'),
      defaultOpen: false,
      icon
    })
  }
  if (streaming) {
    const activityItems = items.filter(isActivityRenderItem)
    const { startedAt, totalProcessingMs } = metadata
    const processingSummary = isFiniteNumber(totalProcessingMs)
      ? formatProcessingDurationMs(totalProcessingMs)
      : '处理了 0秒'
    if (activityItems.length === 0) {
      return isFiniteNumber(startedAt)
        ? [
          {
            kind: 'status',
            partIndexes: [],
            summary: processingSummary,
            defaultOpen: false,
            startedAt
          },
          ...items
        ]
        : items
    }
    return [
      {
        kind: 'activity-group' as const,
        partIndexes: activityItems.flatMap((activity) => activity.partIndexes),
        summary: processingSummary,
        defaultOpen: true,
        icon: activityItems.at(-1)?.icon,
        children: activityItems,
        startedAt: isFiniteNumber(startedAt) ? startedAt : undefined
      },
      ...items.filter((item) => !isActivityRenderItem(item))
    ]
  }

  const activityItems = items.filter(isActivityRenderItem)
  if (activityItems.length === 0) {
    return hasValidDuration(metadata) || interrupted
      ? [
        {
          kind: 'status',
          partIndexes: [],
          summary: completedSummary(metadata, waitingForAnswer),
          defaultOpen: false
        },
        ...items
      ]
      : items
  }

  const firstActivityIndex = items.findIndex(isActivityRenderItem)
  const latestActivity = activityItems.at(-1)
  return items.flatMap((item, index) => {
    if (index === firstActivityIndex) {
      return [
        {
          kind: 'activity-group' as const,
          partIndexes: activityItems.flatMap((activity) => activity.partIndexes),
          summary: completedSummary(metadata, waitingForAnswer),
          defaultOpen: pendingAskIndex >= 0,
          icon: latestActivity?.icon,
          children: activityItems
        }
      ]
    }
    return isActivityRenderItem(item) ? [] : [item]
  })
}
