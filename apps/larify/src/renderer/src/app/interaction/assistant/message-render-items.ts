import { getToolName, isFileUIPart, isToolUIPart, type UIMessage } from 'ai'
import { isVisibleToolPart } from './message-parts/tool-visibility'
import { formatProcessingDuration } from './processing-duration'

export type AssistantRenderItemKind =
  | 'final-text'
  | 'current-text'
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
  return (
    item.kind !== 'final-text' && item.kind !== 'current-text' && item.kind !== 'pending-ask-user'
  )
}

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

function textSummary(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const first = sentenceSegmenter.segment(normalized)[Symbol.iterator]().next()
  return first.done ? normalized : first.value.segment.trim()
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

function isPendingAskUser(part: UIMessage['parts'][number]): boolean {
  return (
    isToolUIPart(part) && getToolName(part) === 'agent_ask_user' && part.state === 'input-available'
  )
}

function pendingAskUserIndex(message: UIMessage): number {
  const lastStepStartIndex = message.parts.findLastIndex((part) => part.type === 'step-start')
  const index = message.parts.findLastIndex(
    (part, partIndex) =>
      partIndex > lastStepStartIndex && isToolUIPart(part) && isVisibleToolPart(part)
  )
  if (index < 0) return -1
  return isPendingAskUser(message.parts[index]) ? index : -1
}

function toolIcon(part: UIMessage['parts'][number]): string | undefined {
  if (!isToolUIPart(part)) return undefined
  const icon = (part.toolMetadata as { icon?: unknown } | undefined)?.icon
  return typeof icon === 'string' ? icon : undefined
}

function completedSummary(metadata: LifecycleMetadata, waitingForAnswer: boolean): string {
  const interrupted = isInterrupted(metadata)
  const status = interrupted ? '已中断' : waitingForAnswer ? '等待回答' : '已完成'
  if (!hasValidDuration(metadata)) {
    return waitingForAnswer ? '等待回答' : interrupted ? '已中断' : '处理过程'
  }
  return `${status} · ${formatProcessingDuration(metadata.startedAt, metadata.completedAt)}`
}

export function buildAssistantRenderItems(
  message: UIMessage,
  streaming: boolean
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
  const directTextKind = interrupted ? undefined : streaming ? 'current-text' : 'final-text'
  const items: AssistantRenderItem[] = []
  const pendingAskIndex = interrupted ? -1 : pendingAskUserIndex(message)
  const waitingForAnswer = pendingAskIndex >= 0

  for (let offset = 0; offset < visibleIndexes.length; offset += 1) {
    const partIndex = visibleIndexes[offset]
    const part = message.parts[partIndex]
    if (!part) continue

    if (directTextKind && part.type === 'text' && partIndex > directTextStartIndex) {
      items.push({
        kind: directTextKind,
        partIndexes: [partIndex],
        summary: textSummary(part.text),
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
        defaultOpen: streaming && offset === visibleIndexes.length - 1
      })
      continue
    }
    if (!isToolUIPart(part)) continue
    if (partIndex === pendingAskIndex && isPendingAskUser(part)) {
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
        isPendingAskUser(nextPart) ||
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
    const { startedAt } = metadata
    if (activityItems.length === 0) {
      return isFiniteNumber(startedAt)
        ? [
            {
              kind: 'status',
              partIndexes: [],
              summary: '处理了 0秒',
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
        summary: '处理了 0秒',
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
