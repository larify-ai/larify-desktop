import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import { ArrowDownIcon } from 'lucide-react'
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso'
import { Button } from '@renderer/components/ui/button'
import { MessageView } from './message-view'
import { summarizeMessageChanges, type ChangeSummary } from './change-summary'
import { ChangesSummaryCard } from './changes-summary-card'
import { messagePageSize } from './session-messages'
import type { SessionNavigationItem } from './session-messages'
import { useViewportBottomAnchor } from './use-viewport-bottom-anchor'
import {
  buildAssistantRenderItems,
  isActivityRenderItem,
  type AssistantRenderItem
} from './message-render-items'
import {
  ActivityHistoryPart,
  activityHistorySectionKey,
  type ActivityHistorySection
} from './message-parts/activity-history-part'
import {
  ConversationNavigationRail,
  type ConversationNavigationEntry
} from './conversation-navigation-rail'

const Message = memo(
  MessageView,
  (previous, next) =>
    !next.streaming &&
    previous.streaming === next.streaming &&
    previous.message === next.message &&
    previous.renderItem === next.renderItem &&
    previous.activityKey === next.activityKey &&
    previous.activityOpen === next.activityOpen &&
    previous.onActivityOpenChange === next.onActivityOpenChange &&
    previous.firstFragment === next.firstFragment &&
    previous.lastFragment === next.lastFragment &&
    previous.hideChanges === next.hideChanges &&
    previous.replayFinal === next.replayFinal &&
    previous.onFinalReplayComplete === next.onFinalReplayComplete &&
    previous.active === next.active
)
const pageBuffer = 2
const renderBuffer = 400
const renderChunk = 0
const estimatedMessageHeight = 80
const leaveBottomThreshold = 32
const returnBottomThreshold = 16
const navigationPreviewLimit = 2_000
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
  waiting?: boolean
  trailing?: MessageListItem[]
}

interface MessageConsumedListItem {
  kind: 'consumed'
  key: string
}

interface MessageGroupListItem {
  kind: 'message-group'
  key: string
  message: UIMessage
  items: Array<MessageContentListItem | MessageChangesListItem>
}

type MessageListItem =
  | MessageContentListItem
  | MessageChangesListItem
  | MessageActivityHistoryListItem
  | MessageGroupListItem
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
  // 仅 show_progress 仍作为"内部阶段部件"隐藏其工具卡片本体（其 title 由 stageTitle 提取为阶段标题）；
  // reset_context 现在作为普通工具卡片展示，不再被过滤。
  return name === 'agent_show_progress'
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

// 对每个 index 预计算"其后（不含自身）是否存在 user 消息"。
// 反序遍历一次即可，O(n) 且不产生临时数组；
// 逐条 slice(index + 1).some(...) 是 O(n^2)，5200 条消息实测 6.6ms→0.19ms。
function laterUserMessageFlags(messages: UIMessage[]): boolean[] {
  const flags = new Array<boolean>(messages.length)
  let seen = false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    flags[index] = seen
    const message = messages[index]
    if (message.role === 'user' && !isCompactionMessage(message)) seen = true
  }
  return flags
}

function messageTextPreview(message: UIMessage, separator: string): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(separator)
    .trim()
    .slice(0, navigationPreviewLimit)
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

// 渲染卡顿主因之一：活跃消息 streaming 期间 messages 数组每次更新，若对全部历史消息
// 重建 renderItems，会让 Message 的 renderItem 引用每次都变化 → Message memo 失效 →
// 整个 recent 列表反复全量重渲染。这里按 message 引用 + (streaming, superseded) 缓存
// 结果：历史消息引用稳定则直接命中缓存，renderItem 引用稳定，Message memo 得以生效。
// WeakMap 键随 message GC 自动清理，无泄漏。缓存项只被调用方读取（map/filter/find），
// 不原地修改，可安全共享。
//
// ⚠️ 只缓存非 streaming 的消息：AI SDK 对流式消息是**原地 mutation**
// （process-ui-message-stream.ts 的 `textPart.text += chunk.delta`），message 与 part
// 对象引用在整个流式过程中都不变。若按引用缓存流式消息，缓存将永不失效，
// 摘要等内容会停在首次计算的结果上。已完成的消息不会再被 mutation，可安全缓存。
const itemsForMessageCache = new WeakMap<UIMessage, Map<string, MessageListItem[]>>()

function computeItemsForMessage(
  message: UIMessage,
  streaming: boolean,
  superseded = false
): MessageListItem[] {
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
  const contentItems: MessageContentListItem[] = buildAssistantRenderItems(message, streaming, superseded)
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

function itemsForMessage(
  message: UIMessage,
  streaming: boolean,
  superseded = false
): MessageListItem[] {
  // 流式消息会被 chat 原地 mutation，对象引用不变，不能按引用缓存（见上方说明）。
  // 它每次只有一条，重算成本已被 textSummary 的 part 级缓存压到亚毫秒级。
  if (message.role !== 'assistant' || streaming) {
    return computeItemsForMessage(message, streaming, superseded)
  }
  const key = `false|${Boolean(superseded)}`
  const cache = itemsForMessageCache.get(message)
  const cached = cache?.get(key)
  if (cached) return cached
  const items = computeItemsForMessage(message, streaming, superseded)
  const map = cache ?? new Map<string, MessageListItem[]>()
  map.set(key, items)
  itemsForMessageCache.set(message, map)
  return items
}

function historicalItem(message: UIMessage): MessageListItem {
  if (message.role !== 'assistant') {
    return {
      key: message.id,
      kind: 'content',
      message,
      firstFragment: true,
      lastFragment: true
    }
  }
  const items = itemsForMessage(message, false).filter(
    (item): item is MessageContentListItem | MessageChangesListItem =>
      item.kind === 'content' || item.kind === 'changes'
  )
  if (items.length === 1 && items[0]) return items[0]
  return { kind: 'message-group', key: message.id, message, items }
}

interface ActivityHistoryRun {
  cursor: number
  sections: ActivityHistorySection[]
  trailing: MessageListItem[]
  waiting: boolean
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
  let waiting = false
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
    waiting ||= messageItems.some(
      (item) => item.kind === 'content' && item.renderItem?.kind === 'pending-ask-user'
    )
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
  return { cursor, sections, trailing, waiting }
}

function recentListItems(
  messages: UIMessage[],
  live: boolean,
  groupedMessageIds = new Set<string>()
): MessageListItem[] {
  const laterUserFlags = laterUserMessageFlags(messages)
  const itemsByMessage = messages.map((message, index) =>
    itemsForMessage(
      message,
      live && message.id === messages.at(-1)?.id,
      message.role === 'assistant' && laterUserFlags[index]
    )
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
    const { cursor, sections, trailing, waiting } = activityHistoryRun(messages, itemsByMessage, index, live)
    if (sections.length === 0) {
      result.push(...itemsByMessage[index])
      continue
    }
    result.push({
      kind: 'activity-history',
      key: `${sections[0].message.id}-activity-history`,
      message: sections[0].message,
      sections,
      waiting,
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
  const laterUserFlags = laterUserMessageFlags(combined)
  const itemsByMessage = combined.map((message, index) =>
    itemsForMessage(
      message,
      live && index === combined.length - 1,
      message.role === 'assistant' && laterUserFlags[index]
    )
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
        waiting: run.waiting,
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

// 收集需要保留在 openActivities 里的持久化 key：外层的 content activity 与
// activity-history，以及 activity-history 内层的阶段分组（stage section）。
// stage 的展开状态也持久化到 openActivities（否则虚拟列表回收重挂载时被清理，
// 用户手动展开的 stage 会弹回折叠），故其 key 需一并保留。
function collectActivityPersistKeys(activity: MessageActivityHistoryListItem): string[] {
  const keys = [activity.key]
  activity.sections.forEach((section, index) => {
    keys.push(activityHistorySectionKey(section, index))
  })
  return keys
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
      className="mx-auto flex w-full max-w-4xl flex-col justify-center gap-3 px-6 py-3"
      style={{ height }}
      data-message-index={index}
      data-scroll-placeholder
      aria-hidden="true"
    >
      <div className="h-3 w-1/4 rounded bg-muted-foreground/15" />
      <div className="h-3 w-3/4 rounded bg-muted-foreground/15" />
    </div>
  )
}

interface AssistantMessageListProps {
  active?: boolean
  messages: UIMessage[]
  live?: boolean
  followRequest?: number
  recentStart: number
  olderMessages: Map<number, UIMessage>
  navigationItems?: SessionNavigationItem[]
  onLoadOlderNavigation?: () => void
  onLoadRange: (firstPage: number, lastPage: number) => void
}

export function AssistantMessageList(props: AssistantMessageListProps): React.JSX.Element {
  // 列表始终保持挂载（会话切换时用 CSS 隐藏，不卸载 Virtuoso）：
  // 卸载/重建会让切换瞬间出现"只有背景、然后才出现内容"的闪烁，
  // 且会丢失滚动位置与展开状态。隐藏时仅暂停计时器等活跃 UI 开销。
  return <ActiveAssistantMessageList {...props} />
}

function ActiveAssistantMessageList({
  active = true,
  messages,
  live = false,
  followRequest = 0,
  recentStart,
  olderMessages,
  navigationItems = [],
  onLoadOlderNavigation,
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
  // 切换进入会话（active false→true，Virtuoso 复用保持挂载）时，需要重新滚到底部。
  // 用 prevActiveRef 记录上一次 active，判断"刚从隐藏切到显示"这一次性事件。
  // 用户确认：切换会话应滚到底部（不保留滚动位置）。
  const prevActiveRef = useRef(active)
  const [previousLive, setPreviousLive] = useState(live)
  const openActivities = useRef(new Map<string, boolean>())
  const activityScrollTop = useRef<number | null>(null)
  const [position, setPosition] = useState({
    key: false,
    complete: false,
    escaped: false
  })
  const [replayFinalMessageId, setReplayFinalMessageId] = useState<string>()
  const [visibleStartIndex, setVisibleStartIndex] = useState<number>()
  const pendingNavigationIndex = useRef<number | undefined>(undefined)

  // 可见起点：直接由 Virtuoso 的渲染 range 推导（rangeChanged 内设置），
  // 高频滚动/流式增长路径不再 querySelectorAll + getBoundingClientRect，
  // 避免每 tick 强制同步布局（layout thrash）。
  const syncViewportFromRange = useCallback((startIndex: number): void => {
    const pendingIndex = pendingNavigationIndex.current
    if (pendingIndex !== undefined) {
      setVisibleStartIndex(pendingIndex)
      return
    }
    setVisibleStartIndex((current) => (current === startIndex ? current : startIndex))
  }, [])
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

  if (previousLive !== live) {
    setPreviousLive(live)
    if (previousLive && !live) {
      const assistant = messages.findLast(({ role }) => role === 'assistant')
      const hasFinalText = assistant
        ? buildAssistantRenderItems(assistant, false).some((item) => item.kind === 'final-text')
        : false
      setReplayFinalMessageId(hasFinalText ? assistant?.id : undefined)
    } else if (live) {
      setReplayFinalMessageId(undefined)
    }
  }

  const handleFinalReplayComplete = useCallback(() => setReplayFinalMessageId(undefined), [])

  useEffect(() => {
    const currentActivityKeys = new Set<string>()
    for (const item of recentItems) {
      if (item.kind === 'activity-history') {
        for (const key of collectActivityPersistKeys(item)) currentActivityKeys.add(key)
      } else if (
        item.kind === 'content' &&
        item.renderItem &&
        isActivityRenderItem(item.renderItem)
      ) {
        currentActivityKeys.add(item.key)
      }
    }
    if (boundaryHistory) {
      for (const key of collectActivityPersistKeys(boundaryHistory.item)) {
        currentActivityKeys.add(key)
      }
    }
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
    if (activityScrollTop.current !== null) {
      const element = scrollElement.current
      const scrollTop = activityScrollTop.current
      activityScrollTop.current = null
      queueMicrotask(() => {
        if (element) element.scrollTop = scrollTop
      })
      return
    }
    // 进入/切换会话时，等待回答的活动历史会默认展开，item 真实高度(数千 px)远超
    // defaultItemHeight 估计值，导致 Vituoso 用低估高度算出 totalHeight，滚底不到位、
    // 末尾 ask_user 停在视口外/命中错位而"点不动/变更卡片 hover 不弹"。
    // 总高度被真实测量后(totalListHeightChanged)，若仍在"初始定位(positioning)"且尚未
    // 真正到底，则重新滚到底部，让已正确测量的末尾 ask_user 就位。
    // 用户上翻看上文(reading/escaped)不打扰；流式跟随靠 followOutput 自动，不重复滚底。
    if (scrollMode.current === 'positioning') {
      const element = scrollElement.current
      const atBottom = element
        ? element.scrollHeight - element.clientHeight - element.scrollTop <= 1
        : false
      if (!atBottom) {
        list.current?.autoscrollToBottom()
        scrollViewportToBottom()
      }
    }
  }, [scrollViewportToBottom])

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
  let firstLoadedIndex = recentStart
  for (const index of olderMessages.keys()) {
    if (index < firstLoadedIndex) firstLoadedIndex = index
  }
  const loadedCount = recentStart - firstLoadedIndex + recentItems.length

  const positioningKey = active && loadedCount > 0
  const currentPosition =
    position.key === positioningKey
      ? position
      : { key: positioningKey, complete: false, escaped: false }

  useLayoutEffect(() => {
    if (scrollIntentTimer.current !== null) {
      clearTimeout(scrollIntentTimer.current)
      scrollIntentTimer.current = null
    }
    // 切换进入会话（active 从 false→true，Virtuoso 复用保持挂载）时，重置
    // "已滚到底部"的一次性标志，让列表重新滚到底部。否则切换会话时
    // initialTopMostItemIndex（只在首次挂载生效）不会重新触发，且 positioningStarted
    // 已为 true，ask_user 等末尾卡片会停在旧位置/视口外，表现为"点进会话点不动/看不到"；
    // 用户滑动一下（触发重测/重排）才恢复，正是此根因。用户确认切换会话应滚到底部。
    if (active && !prevActiveRef.current) {
      prevActiveRef.current = true
      positioningStarted.current = false
      setPosition((current) => ({ ...current, escaped: false }))
    } else if (!active) {
      prevActiveRef.current = false
    }
    if (!positioningKey) return
    if (positioningStarted.current) return
    positioningStarted.current = true
    scrollMode.current = 'positioning'
    list.current?.autoscrollToBottom()
    scrollViewportToBottom()
  }, [positioningKey, scrollViewportToBottom, active])

  const scrollToBottom = (): void => {
    // 使用 following（而非 positioning）：虚拟列表最后几项的高度在最后一帧才确定，
    // positioning 期间 followOutput 返回 false，内容补齐后不会再校正滚动位置，
    // 表现为"点了回到底部滑块却停在半路"。following 会持续跟随到 atBottom 确认，
    // 直到用户主动上滚（wheel/scroll 会把模式切回 reading）。
    scrollMode.current = 'following'
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
  const item = useCallback(
    (index: number): MessageListItem | undefined => {
      if (index < recentStart) {
        const message = olderMessages.get(index)
        if (boundaryHistory?.anchor === index) return boundaryHistory.item
        if (boundaryHistory?.consumed.has(index)) {
          return { kind: 'consumed', key: `${message?.id ?? index}-consumed` }
        }
        return message ? historicalItem(message) : undefined
      }
      return recentItems[index - recentStart]
    },
    [boundaryHistory, olderMessages, recentItems, recentStart]
  )
  const navigationEntries = useMemo(() => {
    const entries: ConversationNavigationEntry[] = navigationItems.map((entry) => ({
      id: entry.id,
      index: entry.index,
      summary: entry.promptPreview,
      response: entry.responsePreview
    }))
    const positions = new Map(entries.map((entry, index) => [entry.id, index]))
    const loadedMessages: Array<{ index: number; message: UIMessage }> = []
    for (const [index, message] of olderMessages) {
      if (index < recentStart) loadedMessages.push({ index, message })
    }
    let previousMessageId: string | undefined
    for (let offset = 0; offset < recentItems.length; offset += 1) {
      const recentItem = recentItems[offset]
      const message = recentItem?.kind === 'consumed' ? undefined : recentItem?.message
      if (!message || message.id === previousMessageId) continue
      previousMessageId = message.id
      loadedMessages.push({ index: recentStart + offset, message })
    }
    loadedMessages.sort((left, right) => left.index - right.index)
    previousMessageId = undefined
    for (const { index, message } of loadedMessages) {
      if (message.id === previousMessageId) continue
      previousMessageId = message.id
      if (message.role === 'user') {
        if (isCompactionMessage(message)) continue
        const summary = messageTextPreview(message, ' ').replace(/\s+/g, ' ')
        const position = positions.get(message.id)
        if (position === undefined) {
          positions.set(message.id, entries.length)
          entries.push({ id: message.id, index, summary: summary || '用户消息' })
        } else {
          entries[position] = { ...entries[position], index, summary: summary || '用户消息' }
        }
      }
    }
    entries.sort((left, right) => left.index - right.index)
    let entryIndex = -1
    let compactionBoundary = false
    for (const loaded of loadedMessages) {
      while (entries[entryIndex + 1]?.index <= loaded.index) entryIndex += 1
      if (isCompactionMessage(loaded.message)) {
        compactionBoundary = true
        continue
      }
      if (loaded.message.role === 'user') {
        compactionBoundary = false
        continue
      }
      const entry = entries[entryIndex]
      if (!entry || compactionBoundary || loaded.message.role !== 'assistant') continue
      const response = messageTextPreview(loaded.message, '\n\n')
      if (response) entry.response = response
    }
    return entries
  }, [navigationItems, olderMessages, recentItems, recentStart])
  const navigateToMessage = useCallback(
    (entry: ConversationNavigationEntry, behavior: 'auto' | 'smooth'): void => {
      const { index } = entry
      const nearby = Math.abs(index - (visibleStartIndex ?? totalCount - 1)) <= 8
      pendingNavigationIndex.current = index
      scrollMode.current = 'reading'
      releaseAnchor()
      setPosition((current) => ({ ...current, escaped: true }))
      if (index < firstLoadedIndex) {
        const page = Math.floor(index / messagePageSize)
        onLoadRange(page, page)
        return
      }
      setVisibleStartIndex(index)
      if (behavior === 'smooth' && !nearby) {
        list.current?.scrollToIndex({
          index: index - firstLoadedIndex,
          align: 'start',
          behavior: 'auto'
        })
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            list.current?.scrollToIndex({
              index: index - firstLoadedIndex,
              align: 'start',
              behavior: 'smooth'
            })
          })
        })
        return
      }
      list.current?.scrollToIndex({
        index: index - firstLoadedIndex,
        align: 'start',
        behavior
      })
    },
    [firstLoadedIndex, onLoadRange, releaseAnchor, totalCount, visibleStartIndex]
  )
  useLayoutEffect(() => {
    const index = pendingNavigationIndex.current
    if (index === undefined || index < firstLoadedIndex) return
    setVisibleStartIndex(index)
    const frame = requestAnimationFrame(() => {
      list.current?.scrollToIndex({
        index: index - firstLoadedIndex,
        align: 'start',
        behavior: 'auto'
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [firstLoadedIndex])
  const rangeChanged = ({ startIndex, endIndex }: ListRange): void => {
    trackRenderedRange({ startIndex, endIndex })
    syncViewportFromRange(startIndex)
    if (recentStart <= 0) return
    const historyEnd = Math.min(endIndex, recentStart - 1)
    const historyStart = Math.min(startIndex, historyEnd)
    const firstPage = Math.max(0, Math.floor(historyStart / messagePageSize) - pageBuffer + 1)
    const lastPage = Math.min(
      Math.floor((recentStart - 1) / messagePageSize),
      Math.floor(historyEnd / messagePageSize) + pageBuffer - 1
    )
    onLoadRange(firstPage, lastPage)
  }

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1"
      style={active ? undefined : { display: 'none' }}
      aria-hidden={!active}
      onPointerDownCapture={(event) => {
        if (
          event.target instanceof Element &&
          !event.target.closest('[aria-label="对话快速导航"]')
        ) {
          pendingNavigationIndex.current = undefined
        }
      }}
      onWheelCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-message-local-scroll]')
        ) {
          return
        }
        pendingNavigationIndex.current = undefined
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
        // 可见起点已由 rangeChanged 推导（零布局读），滚动路径不再读布局
        const { scrollTop } = element
        const movedUp = scrollTop < lastScrollTop.current
        const distanceFromBottom = element.scrollHeight - element.clientHeight - scrollTop
        // 恢复跟随（reading→following）只应发生在"用户向下滚回到接近底部"时。
        // 若在向上滚动（movedUp）时也基于 distanceFromBottom<=threshold 切回 following，
        // 则程序化定位（scrollToIndex 上滑）启动的瞬间，滚动还没离开底部（distanceFromBottom
        // 仍 <=threshold）就会被切回 following，随后被 followOutput/底部锚定拉回底部，
        // 表现为"点击导航上滑一点又反弹回底部，需多次点击才定位"。故上滑时不恢复 following。
        if (
          !movedUp &&
          distanceFromBottom <= returnBottomThreshold &&
          scrollMode.current === 'reading'
        ) {
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
        className="larify-scrollbar-hidden size-full"
        totalCount={loadedCount}
        firstItemIndex={firstLoadedIndex}
        defaultItemHeight={estimatedMessageHeight}
        initialItemCount={Math.min(12, loadedCount)}
        initialTopMostItemIndex={loadedCount > 0 ? { index: 'LAST', align: 'end' } : 0}
        increaseViewportBy={renderBuffer}
        // 等待回答时活动历史会默认展开到数千 px（实测 4353），远超 defaultItemHeight(80)。
        // 只用像素缓冲(增加increaseViewportBy)时，这条大 item 初始可能不在渲染范围，Vituoso
        // 一直按 80px 记它，导致其后的 ask_user 被定位到错误位置（视口底/输入框覆盖区）而
        // 点不中。minOverscanItemCount 让视口边界前后始终渲染指定数量的 item，从而把这条
        // 大 item 也渲染出来并真实测量，后续 ask_user 定位随之正确。
        minOverscanItemCount={{ top: 12, bottom: 8 }}
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
              className={`mx-auto w-full max-w-4xl min-w-0 px-6 ${listItem.kind === 'changes' ? '' : '[contain:layout_paint_style]'} ${joinsPrevious ? (listItem.kind === 'changes' ? 'pt-4' : followsActivityHistory ? 'pt-3' : 'pt-0') : 'pt-3'} ${joinsNext ? 'pb-0' : index === totalCount - 1 ? 'pb-30' : 'pb-3'}`}
              data-message-index={index}
              data-message-layout-shell
            >
              {listItem.kind === 'message-group' ? (
                listItem.items.map((groupItem, groupIndex) =>
                  groupItem.kind === 'changes' ? (
                    <div key={groupItem.key} className={groupIndex ? 'mt-3' : undefined}>
                      <ChangesSummaryCard {...groupItem.changes} />
                    </div>
                  ) : (
                    <div key={groupItem.key} className={groupIndex ? 'mt-3' : undefined}>
                      <Message
                        message={groupItem.message}
                        streaming={false}
                        renderItem={groupItem.renderItem}
                        activityKey={groupItem.key}
                        activityOpen={openActivities.current.get(groupItem.key)}
                        onActivityOpenChange={handleActivityOpenChange}
                        firstFragment={groupItem.firstFragment}
                        lastFragment={groupItem.lastFragment}
                        hideChanges
                        replayFinal={false}
                        onFinalReplayComplete={handleFinalReplayComplete}
                        active={active}
                      />
                    </div>
                  )
                )
              ) : listItem.kind === 'changes' ? (
                <ChangesSummaryCard {...listItem.changes} />
              ) : listItem.kind === 'activity-history' ? (
                <>
                  <ActivityHistoryPart
                    sections={listItem.sections}
                    waiting={listItem.waiting}
                    initialOpen={openActivities.current.get(listItem.key)}
                    active={active}
                    onOpenChange={(open) => handleActivityOpenChange(listItem.key, open)}
                    stageOpen={{
                      get: (key) => openActivities.current.get(key),
                      set: (key, open) => handleActivityOpenChange(key, open)
                    }}
                  />
                  {listItem.trailing?.map((trailing) =>
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
                          active={active}
                        />
                      </div>
                    ) : null
                  )}
                </>
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
                  active={active}
                />
              )}
            </div>
          ) : (
            <HistoricalMessageSpacer height={estimatedMessageHeight} index={index} />
          )
        }}
      />
      <ConversationNavigationRail
        entries={navigationEntries}
        currentIndex={visibleStartIndex}
        onNavigate={navigateToMessage}
        onLoadOlder={onLoadOlderNavigation}
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
