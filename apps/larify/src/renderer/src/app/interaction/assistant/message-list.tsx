import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import { ArrowDownIcon } from 'lucide-react'
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso'
import { Button } from '@renderer/components/ui/button'
import { MessageView } from './message-view'
import { summarizeMessageChanges, type ChangeSummary } from './change-summary'
import { ChangesSummaryCard } from './changes-summary-card'
import { messagePageSize } from './session-messages'
import { useViewportBottomAnchor } from './use-viewport-bottom-anchor'
import {
  buildAssistantRenderItems,
  isActivityRenderItem,
  type AssistantRenderItem
} from './message-render-items'
import {
  ActivityHistoryPart,
  type ActivityHistorySection
} from './message-parts/activity-history-part'

const Message = memo(
  MessageView,
  (previous, next) =>
    !next.streaming &&
    previous.streaming === next.streaming &&
    previous.message === next.message &&
    previous.activityKey === next.activityKey &&
    previous.activityOpen === next.activityOpen &&
    previous.onActivityOpenChange === next.onActivityOpenChange &&
    previous.firstFragment === next.firstFragment &&
    previous.lastFragment === next.lastFragment &&
    previous.hideChanges === next.hideChanges &&
    previous.replayFinal === next.replayFinal &&
    previous.onFinalReplayComplete === next.onFinalReplayComplete
)
const pageBuffer = 2
const renderBuffer = 400
const renderChunk = 0
const estimatedMessageHeight = 80
const leaveBottomThreshold = 32
const returnBottomThreshold = 16
type ScrollMode = 'positioning' | 'following' | 'reading'

interface MessageContentListItem {
  kind: 'content'
  key: string
  message: UIMessage
  renderItem?: AssistantRenderItem
  firstFragment: boolean
  lastFragment: boolean
  streaming?: boolean
}

interface MessageChangesListItem {
  kind: 'changes'
  key: string
  changes: ChangeSummary
  message: UIMessage
}

interface MessageActivityHistoryListItem {
  kind: 'activity-history'
  key: string
  message: UIMessage
  sections: ActivityHistorySection[]
  trailing?: MessageListItem[]
}

interface MessageConsumedListItem {
  kind: 'consumed'
  key: string
}

type MessageListItem =
  | MessageContentListItem
  | MessageChangesListItem
  | MessageActivityHistoryListItem
  | MessageConsumedListItem

function stageTitle(part: UIMessage['parts'][number] | undefined): string | undefined {
  if (
    !part ||
    !isToolUIPart(part) ||
    !part.input ||
    typeof part.input !== 'object' ||
    Array.isArray(part.input)
  ) {
    return undefined
  }
  if (getToolName(part) !== 'agent_show_progress') return undefined
  const title = (part.input as Record<string, unknown>).title
  return typeof title === 'string' && title.trim() ? title.trim() : undefined
}

function hasStageBoundary(message: UIMessage | undefined): boolean {
  return Boolean(message?.parts.some((part) => stageTitle(part) !== undefined))
}

function isInternalStagePart(part: UIMessage['parts'][number] | undefined): boolean {
  if (!part || !isToolUIPart(part)) return false
  const name = getToolName(part)
  return name === 'agent_reset_context' || name === 'agent_show_progress'
}

function toolPartTitle(part: UIMessage['parts'][number] | undefined): string | undefined {
  if (!part || !isToolUIPart(part)) return undefined
  const input = part.input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const title = (input as Record<string, unknown>).toolCallTitle
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
  return getToolName(part)
}

function withoutInternalStageParts(
  item: AssistantRenderItem,
  message: UIMessage
): AssistantRenderItem {
  const partIndexes = item.partIndexes.filter((index) => !isInternalStagePart(message.parts[index]))
  const children = item.children
    ?.map((child) => withoutInternalStageParts(child, message))
    .filter((child) => child.partIndexes.length > 0 || child.kind === 'status')
  const filteredToolGroup =
    item.kind === 'tool-group' && partIndexes.length !== item.partIndexes.length
  return {
    ...item,
    partIndexes,
    ...(filteredToolGroup && {
      summary: partIndexes
        .map((index) => toolPartTitle(message.parts[index]))
        .filter((title): title is string => title !== undefined)
        .join('、')
    }),
    ...(children && { children })
  }
}

function isCompactionMessage(message: UIMessage | undefined): boolean {
  return Boolean(
    message?.role === 'user' &&
    message.metadata &&
    typeof message.metadata === 'object' &&
    (message.metadata as Record<string, unknown>).compaction === true
  )
}

function filterRenderItem(
  item: AssistantRenderItem,
  allowedIndexes: Set<number>
): AssistantRenderItem | undefined {
  const partIndexes = item.partIndexes.filter((index) => allowedIndexes.has(index))
  const children = item.children
    ?.map((child) => filterRenderItem(child, allowedIndexes))
    .filter((child): child is AssistantRenderItem => child !== undefined)
  if (partIndexes.length === 0 && (!children || children.length === 0)) return undefined
  return {
    ...item,
    partIndexes,
    ...(children && { children })
  }
}

function itemsForMessage(message: UIMessage, streaming: boolean): MessageListItem[] {
  if (message.role !== 'assistant') {
    return [
      {
        kind: 'content',
        key: message.id,
        message,
        firstFragment: true,
        lastFragment: true
      }
    ]
  }
  const changes = summarizeMessageChanges(message)
  const contentItems: MessageContentListItem[] = buildAssistantRenderItems(message, streaming)
    .map((renderItem) => withoutInternalStageParts(renderItem, message))
    .filter((renderItem) => renderItem.partIndexes.length > 0 || renderItem.kind === 'status')
    .map((renderItem) => ({
      kind: 'content',
      key:
        renderItem.kind === 'status' || renderItem.kind === 'activity-group'
          ? `${message.id}-activity`
          : `${message.id}-${renderItem.partIndexes[0] ?? renderItem.kind}`,
      message,
      renderItem,
      firstFragment: false,
      lastFragment: false
    }))
  if (contentItems.length > 0) {
    contentItems[0].firstFragment = true
    contentItems[contentItems.length - 1].lastFragment = true
  }
  return changes
    ? [...contentItems, { changes, kind: 'changes', key: `${message.id}-changes`, message }]
    : contentItems
}

interface ActivityHistoryRun {
  cursor: number
  sections: ActivityHistorySection[]
  trailing: MessageListItem[]
}

function activityHistoryRun(
  messages: UIMessage[],
  itemsByMessage: MessageListItem[][],
  start: number,
  live: boolean
): ActivityHistoryRun {
  const sections: ActivityHistorySection[] = []
  const trailing: MessageListItem[] = []
  const pending: Array<{
    message: UIMessage
    item: AssistantRenderItem
    streaming: boolean
  }> = []
  let activeTitle: string | undefined
  let pendingStartTitle: string | undefined
  let seenBoundary = false
  let cursor = start

  const append = (
    title: string,
    message: UIMessage,
    item: AssistantRenderItem,
    streaming: boolean
  ): void => {
    const entry = { message, item, streaming }
    const previous = sections.at(-1)
    if (previous?.title === title) {
      previous.continuations = [...(previous.continuations ?? []), entry]
      previous.streaming ||= streaming
    } else {
      sections.push({ title, ...entry })
    }
  }
  const flushPending = (title: string, preserveStreaming = false): void => {
    for (const entry of pending.splice(0)) {
      append(title, entry.message, entry.item, preserveStreaming && entry.streaming)
    }
  }
  const startPendingStage = (): void => {
    if (!pendingStartTitle) return
    flushPending(activeTitle ?? pendingStartTitle)
    activeTitle = pendingStartTitle
    pendingStartTitle = undefined
  }

  while (cursor < messages.length) {
    const message = messages[cursor]
    if (isCompactionMessage(message)) {
      cursor += 1
      continue
    }
    if (message.role !== 'assistant') break
    if (cursor === start && !hasStageBoundary(message)) break
    const messageItems = itemsByMessage[cursor]
    const activityIndex = messageItems.findIndex(
      (item) =>
        item.kind === 'content' &&
        item.renderItem !== undefined &&
        isActivityRenderItem(item.renderItem)
    )
    const activity = messageItems[activityIndex]
    if (activity?.kind !== 'content' || !activity.renderItem) break
    const boundaries = message.parts.flatMap((part, index) => {
      const title = stageTitle(part)
      return title ? [{ index, title }] : []
    })
    let lowerBound = -1
    for (const { index: boundaryIndex, title } of boundaries) {
      const item = filterRenderItem(
        activity.renderItem,
        new Set(
          activity.renderItem.partIndexes.filter(
            (partIndex) => partIndex > lowerBound && partIndex < boundaryIndex
          )
        )
      )
      if (item) {
        startPendingStage()
        pending.push({ message, item, streaming: false })
      }
      pendingStartTitle = title
      seenBoundary = true
      lowerBound = boundaryIndex
    }
    if (seenBoundary) {
      const item = filterRenderItem(
        activity.renderItem,
        new Set(activity.renderItem.partIndexes.filter((partIndex) => partIndex > lowerBound))
      )
      if (item) {
        startPendingStage()
        pending.push({
          message,
          item,
          streaming: live && message.id === messages.at(-1)?.id
        })
      }
    }
    for (const item of messageItems.filter((_, itemIndex) => itemIndex !== activityIndex)) {
      if (item.kind === 'changes') {
        const previousChanges = trailing.findIndex(
          (trailingItem) => trailingItem.kind === 'changes'
        )
        if (previousChanges >= 0) trailing.splice(previousChanges, 1)
      }
      trailing.push(item)
    }
    cursor += 1
  }
  if (activeTitle) {
    if (live && cursor === messages.length && pendingStartTitle && pending.length > 0) {
      pending[pending.length - 1].streaming = true
    }
    flushPending(activeTitle, true)
  }
  return { cursor, sections, trailing }
}

function recentListItems(
  messages: UIMessage[],
  live: boolean,
  groupedMessageIds = new Set<string>()
): MessageListItem[] {
  const itemsByMessage = messages.map((message) =>
    itemsForMessage(message, live && message.id === messages.at(-1)?.id)
  )
  const result: MessageListItem[] = []

  for (let index = 0; index < messages.length; index += 1) {
    if (groupedMessageIds.has(messages[index].id)) {
      if (isCompactionMessage(messages[index])) continue
      result.push(
        ...itemsByMessage[index].filter(
          (item) =>
            item.kind !== 'changes' &&
            (item.kind !== 'content' || !item.renderItem || !isActivityRenderItem(item.renderItem))
        )
      )
      continue
    }
    if (!hasStageBoundary(messages[index])) {
      result.push(...itemsByMessage[index])
      continue
    }
    const { cursor, sections, trailing } = activityHistoryRun(messages, itemsByMessage, index, live)
    if (sections.length === 0) {
      result.push(...itemsByMessage[index])
      continue
    }
    result.push({
      kind: 'activity-history',
      key: `${sections[0].message.id}-activity-history`,
      message: sections[0].message,
      sections,
      trailing
    })
    index = cursor - 1
  }
  return result
}

interface BoundaryActivityHistory {
  anchor: number
  consumed: Set<number>
  item: MessageActivityHistoryListItem
  recentMessageIds: Set<string>
}

function boundaryActivityHistory(
  messages: UIMessage[],
  olderMessages: Map<number, UIMessage>,
  recentStart: number,
  live: boolean
): BoundaryActivityHistory | undefined {
  if (!messages.length || recentStart <= 0 || !olderMessages.has(recentStart - 1)) return undefined
  const older: Array<[number, UIMessage]> = []
  for (let index = recentStart - 1; index >= 0; index -= 1) {
    const message = olderMessages.get(index)
    if (!message) break
    older.unshift([index, message])
  }
  const boundary = older.length
  const combined = [...older.map(([, message]) => message), ...messages]
  const itemsByMessage = combined.map((message, index) =>
    itemsForMessage(message, live && index === combined.length - 1)
  )
  for (let start = 0; start < boundary; start += 1) {
    if (!hasStageBoundary(combined[start])) continue
    const run = activityHistoryRun(combined, itemsByMessage, start, live)
    if (!run.sections.length || run.cursor <= boundary) continue
    const anchor = older.at(-1)![0]
    const olderIds = new Set(older.slice(start, boundary).map(([, message]) => message.id))
    return {
      anchor,
      consumed: new Set(older.slice(start, boundary - 1).map(([index]) => index)),
      item: {
        kind: 'activity-history',
        key: `${run.sections[0].message.id}-activity-history`,
        message: run.sections[0].message,
        sections: run.sections,
        trailing: run.trailing
      },
      recentMessageIds: new Set(
        combined
          .slice(start, run.cursor)
          .filter((message) => !olderIds.has(message.id))
          .map((message) => message.id)
      )
    }
  }
  return undefined
}

function HistoricalMessageSpacer({
  height,
  index
}: {
  height: number
  index: number
}): React.JSX.Element {
  return (
    <div
      className="w-full"
      style={{ height }}
      data-message-index={index}
      data-scroll-placeholder
      aria-hidden="true"
    />
  )
}

interface AssistantMessageListProps {
  active?: boolean
  messages: UIMessage[]
  live?: boolean
  followRequest?: number
  recentStart: number
  olderMessages: Map<number, UIMessage>
  onLoadRange: (firstPage: number, lastPage: number) => void
}

export function AssistantMessageList(props: AssistantMessageListProps): React.JSX.Element {
  if (props.active === false) {
    return <div className="relative min-h-0 min-w-0 flex-1" aria-hidden="true" />
  }
  return <ActiveAssistantMessageList {...props} />
}

function ActiveAssistantMessageList({
  active = true,
  messages,
  live = false,
  followRequest = 0,
  recentStart,
  olderMessages,
  onLoadRange
}: AssistantMessageListProps): React.JSX.Element {
  const list = useRef<VirtuosoHandle>(null)
  const scrollMode = useRef<ScrollMode>('positioning')
  const scrollElement = useRef<HTMLElement | null>(null)
  const lastScrollTop = useRef(0)
  const resizingMessage = useRef(false)
  const resizeVersion = useRef(0)
  const scrollIntentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const positioningStarted = useRef(false)
  const previousLive = useRef(live)
  const openActivities = useRef(new Map<string, boolean>())
  const activityScrollTop = useRef<number | null>(null)
  const [position, setPosition] = useState({
    key: false,
    complete: false,
    escaped: false
  })
  const [replayFinalMessageId, setReplayFinalMessageId] = useState<string>()
  const {
    trackRenderedRange,
    scrollerRef,
    releaseAnchor,
    scrollToBottom: scrollViewportToBottom
  } = useViewportBottomAnchor(active)
  const boundaryHistory = useMemo(
    () => boundaryActivityHistory(messages, olderMessages, recentStart, live),
    [live, messages, olderMessages, recentStart]
  )
  const recentItems = useMemo(
    () => recentListItems(messages, live, boundaryHistory?.recentMessageIds),
    [boundaryHistory, live, messages]
  )

  useLayoutEffect(() => {
    if (previousLive.current && !live) {
      const assistant = messages.findLast(({ role }) => role === 'assistant')
      const hasFinalText = assistant
        ? buildAssistantRenderItems(assistant, false).some((item) => item.kind === 'final-text')
        : false
      setReplayFinalMessageId(hasFinalText ? assistant?.id : undefined)
    } else if (live) {
      setReplayFinalMessageId(undefined)
    }
    previousLive.current = live
  }, [live, messages])

  const handleFinalReplayComplete = useCallback(() => setReplayFinalMessageId(undefined), [])

  useEffect(() => {
    const currentActivityKeys = new Set<string>()
    for (const item of recentItems) {
      if (
        item.kind === 'activity-history' ||
        (item.kind === 'content' && item.renderItem && isActivityRenderItem(item.renderItem))
      ) {
        currentActivityKeys.add(item.key)
      }
    }
    if (boundaryHistory) currentActivityKeys.add(boundaryHistory.item.key)
    for (const key of openActivities.current.keys()) {
      if (!currentActivityKeys.has(key)) openActivities.current.delete(key)
    }
  }, [boundaryHistory, recentItems])

  const handleActivityOpenChange = useCallback(
    (key: string, open: boolean) => {
      if (open) {
        activityScrollTop.current = scrollElement.current?.scrollTop ?? null
        openActivities.current.set(key, true)
        scrollMode.current = 'reading'
        releaseAnchor()
        setPosition((current) => ({ ...current, escaped: true }))
      } else {
        openActivities.current.set(key, false)
        activityScrollTop.current = null
      }
    },
    [releaseAnchor]
  )

  const handleScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      scrollerRef(element)
      scrollElement.current = element instanceof HTMLElement ? element : null
      lastScrollTop.current = scrollElement.current?.scrollTop ?? 0
    },
    [scrollerRef]
  )

  const handleTotalListHeightChanged = useCallback(() => {
    if (activityScrollTop.current === null) return
    const element = scrollElement.current
    const scrollTop = activityScrollTop.current
    activityScrollTop.current = null
    queueMicrotask(() => {
      if (element) element.scrollTop = scrollTop
    })
  }, [])

  useLayoutEffect(() => {
    if (live && scrollMode.current === 'following') {
      scrollViewportToBottom()
      list.current?.autoscrollToBottom()
    }
  }, [live, messages, scrollViewportToBottom])

  useLayoutEffect(() => {
    if (followRequest === 0) return
    scrollMode.current = 'following'
    const followBottom = (): void => {
      list.current?.autoscrollToBottom()
      scrollViewportToBottom()
    }
    followBottom()
    const frame = requestAnimationFrame(followBottom)
    return () => cancelAnimationFrame(frame)
  }, [followRequest, scrollViewportToBottom])

  useEffect(
    () => () => {
      if (scrollIntentTimer.current !== null) clearTimeout(scrollIntentTimer.current)
    },
    []
  )

  const followGrowingList = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element || typeof ResizeObserver === 'undefined') return
      const listElement = element.closest('[data-testid="virtuoso-item-list"]') ?? element
      const observer = new ResizeObserver(() => {
        const version = ++resizeVersion.current
        resizingMessage.current = true
        if (scrollMode.current === 'following') {
          scrollViewportToBottom()
          list.current?.autoscrollToBottom()
        }
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (resizeVersion.current === version) resizingMessage.current = false
          }, 1)
        })
      })
      observer.observe(listElement)
      return () => observer.disconnect()
    },
    [scrollViewportToBottom]
  )

  const totalCount = recentStart + recentItems.length
  const positioningKey = active && totalCount > 0
  const currentPosition =
    position.key === positioningKey
      ? position
      : { key: positioningKey, complete: false, escaped: false }

  useLayoutEffect(() => {
    if (scrollIntentTimer.current !== null) {
      clearTimeout(scrollIntentTimer.current)
      scrollIntentTimer.current = null
    }
    if (!positioningKey) {
      positioningStarted.current = false
      return
    }
    if (positioningStarted.current) return
    positioningStarted.current = true
    scrollMode.current = 'positioning'
    list.current?.autoscrollToBottom()
    scrollViewportToBottom()
  }, [positioningKey, scrollViewportToBottom])

  const scrollToBottom = (): void => {
    scrollMode.current = 'positioning'
    setPosition((current) => ({ ...current, escaped: false }))
    list.current?.autoscrollToBottom()
    scrollViewportToBottom()
  }
  const handleAtBottomChange = (nextAtBottom: boolean): void => {
    const preserveReadingPosition = nextAtBottom && scrollMode.current === 'reading'
    setPosition((current) => {
      const sameKey = current.key === positioningKey
      const next = {
        key: positioningKey,
        complete: sameKey ? current.complete || nextAtBottom : nextAtBottom,
        escaped: preserveReadingPosition
          ? sameKey && current.escaped
          : nextAtBottom
            ? false
            : sameKey && current.escaped
      }
      return current.key === next.key &&
        current.complete === next.complete &&
        current.escaped === next.escaped
        ? current
        : next
    })
    if (nextAtBottom && !preserveReadingPosition) {
      scrollMode.current = 'following'
    } else if (scrollMode.current === 'positioning') {
      list.current?.autoscrollToBottom()
      scrollViewportToBottom()
    }
  }
  const item = (index: number): MessageListItem | undefined => {
    if (index < recentStart) {
      const message = olderMessages.get(index)
      if (boundaryHistory?.anchor === index) return boundaryHistory.item
      if (boundaryHistory?.consumed.has(index)) {
        return { kind: 'consumed', key: `${message?.id ?? index}-consumed` }
      }
      return message
        ? {
            key: message.id,
            kind: 'content',
            message,
            firstFragment: true,
            lastFragment: true
          }
        : undefined
    }
    return recentItems[index - recentStart]
  }
  const rangeChanged = ({ startIndex, endIndex }: ListRange): void => {
    trackRenderedRange({ startIndex, endIndex })
    if (recentStart <= 0 || startIndex >= recentStart) return
    const firstPage = Math.max(0, Math.floor(startIndex / messagePageSize) - pageBuffer)
    const lastPage = Math.min(
      Math.floor((recentStart - 1) / messagePageSize),
      Math.floor(endIndex / messagePageSize) + pageBuffer
    )
    onLoadRange(firstPage, lastPage)
  }

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1"
      onWheelCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-message-local-scroll]')
        ) {
          return
        }
        if (event.deltaY < 0 && (scrollElement.current?.scrollTop ?? 0) > 0) {
          if (scrollMode.current !== 'reading') {
            scrollMode.current = 'reading'
            releaseAnchor()
            setPosition((current) =>
              current.key === positioningKey ? { ...current, escaped: true } : current
            )
          }
        }
      }}
      onScrollCapture={(event) => {
        const element = scrollElement.current
        if (!element || event.target !== element) return
        const { scrollTop } = element
        const movedUp = scrollTop < lastScrollTop.current
        const distanceFromBottom = element.scrollHeight - element.clientHeight - scrollTop
        if (distanceFromBottom <= returnBottomThreshold && scrollMode.current === 'reading') {
          scrollMode.current = 'following'
          setPosition((current) => ({ ...current, escaped: false }))
        }
        if (movedUp && scrollMode.current !== 'reading') {
          if (scrollIntentTimer.current !== null) clearTimeout(scrollIntentTimer.current)
          scrollIntentTimer.current = setTimeout(() => {
            scrollIntentTimer.current = null
            const leftBottom =
              scrollElement.current === element &&
              element.scrollTop <= scrollTop &&
              element.scrollHeight - element.clientHeight - element.scrollTop >=
                leaveBottomThreshold
            if (!resizingMessage.current && scrollMode.current !== 'reading' && leftBottom) {
              scrollMode.current = 'reading'
              releaseAnchor()
              setPosition((current) =>
                current.key === positioningKey ? { ...current, escaped: true } : current
              )
            } else if (scrollMode.current === 'positioning') {
              scrollMode.current = 'following'
            }
          }, 1)
        }
        lastScrollTop.current = scrollTop
      }}
    >
      <Virtuoso
        data-message-scroll-viewport
        ref={list}
        scrollerRef={handleScrollerRef}
        role="log"
        className="size-full [scrollbar-gutter:stable]"
        totalCount={totalCount}
        defaultItemHeight={estimatedMessageHeight}
        initialItemCount={Math.min(12, totalCount)}
        initialTopMostItemIndex={totalCount > 0 ? { index: 'LAST', align: 'end' } : 0}
        increaseViewportBy={renderBuffer}
        overscan={renderChunk}
        followOutput={() => (scrollMode.current === 'following' ? 'auto' : false)}
        rangeChanged={rangeChanged}
        totalListHeightChanged={handleTotalListHeightChanged}
        atBottomStateChange={handleAtBottomChange}
        computeItemKey={(index) => item(index)?.key ?? index}
        itemContent={(index) => {
          const listItem = item(index)
          if (listItem?.kind === 'consumed') {
            return <div className="h-0" data-message-index={index} aria-hidden />
          }
          const message = listItem?.message
          const previousItem = item(index - 1)
          const nextItem = item(index + 1)
          const previousMessage =
            previousItem && 'message' in previousItem ? previousItem.message : undefined
          const nextMessage = nextItem && 'message' in nextItem ? nextItem.message : undefined
          const joinsPrevious =
            message?.role === 'assistant' && previousMessage?.role === 'assistant'
          const followsActivityHistory = previousItem?.kind === 'activity-history'
          const joinsNext = message?.role === 'assistant' && nextMessage?.role === 'assistant'
          return message ? (
            <div
              ref={index === totalCount - 1 ? followGrowingList : undefined}
              className={`mx-auto w-[calc(100%-var(--larify-scrollbar-size))] max-w-4xl min-w-0 translate-x-[calc(var(--larify-scrollbar-size)/2)] px-6 ${listItem.kind === 'changes' ? '' : '[contain:layout_paint_style]'} ${joinsPrevious ? (listItem.kind === 'changes' ? 'pt-4' : followsActivityHistory ? 'pt-3' : 'pt-0') : 'pt-3'} ${joinsNext ? 'pb-0' : index === totalCount - 1 ? 'pb-30' : 'pb-3'}`}
              data-message-index={index}
            >
              {listItem.kind === 'changes' ? (
                <ChangesSummaryCard {...listItem.changes} />
              ) : listItem.kind === 'activity-history' ? (
                listItem.trailing?.length ? (
                  <>
                    <ActivityHistoryPart
                      sections={listItem.sections}
                      initialOpen={openActivities.current.get(listItem.key)}
                      onOpenChange={(open) => handleActivityOpenChange(listItem.key, open)}
                    />
                    {listItem.trailing.map((trailing) =>
                      trailing.kind === 'changes' ? (
                        <div key={trailing.key} className="mt-3">
                          <ChangesSummaryCard {...trailing.changes} />
                        </div>
                      ) : trailing.kind === 'content' ? (
                        <div key={trailing.key} className="mt-3">
                          <Message
                            message={trailing.message}
                            streaming={trailing.streaming ?? false}
                            renderItem={trailing.renderItem}
                            activityKey={trailing.key}
                            activityOpen={openActivities.current.get(trailing.key)}
                            onActivityOpenChange={handleActivityOpenChange}
                            firstFragment={trailing.firstFragment}
                            lastFragment={trailing.lastFragment}
                            hideChanges
                            replayFinal={false}
                            onFinalReplayComplete={handleFinalReplayComplete}
                          />
                        </div>
                      ) : null
                    )}
                  </>
                ) : (
                  <ActivityHistoryPart
                    sections={listItem.sections}
                    initialOpen={openActivities.current.get(listItem.key)}
                    onOpenChange={(open) => handleActivityOpenChange(listItem.key, open)}
                  />
                )
              ) : (
                <Message
                  message={message}
                  streaming={
                    live && message.role === 'assistant' && message.id === messages.at(-1)?.id
                  }
                  renderItem={listItem.renderItem}
                  activityKey={listItem.key}
                  activityOpen={openActivities.current.get(listItem.key)}
                  onActivityOpenChange={handleActivityOpenChange}
                  firstFragment={listItem.firstFragment}
                  lastFragment={listItem.lastFragment}
                  hideChanges
                  replayFinal={replayFinalMessageId === message.id}
                  onFinalReplayComplete={handleFinalReplayComplete}
                />
              )}
            </div>
          ) : (
            <HistoricalMessageSpacer height={estimatedMessageHeight} index={index} />
          )
        }}
      />
      {active && currentPosition.complete && currentPosition.escaped && messages.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full dark:bg-background dark:hover:bg-muted"
          aria-label="返回底部"
          onClick={scrollToBottom}
        >
          <ArrowDownIcon className="size-4" />
        </Button>
      )}
    </div>
  )
}
