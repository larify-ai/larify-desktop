import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
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
    previous.hideChanges === next.hideChanges
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
}

interface MessageChangesListItem {
  kind: 'changes'
  key: string
  changes: ChangeSummary
  message: UIMessage
}

type MessageListItem = MessageContentListItem | MessageChangesListItem

function recentListItems(messages: UIMessage[], live: boolean): MessageListItem[] {
  return messages.flatMap((message): MessageListItem[] => {
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
    const streaming = live && message.id === messages.at(-1)?.id
    const contentItems: MessageContentListItem[] = buildAssistantRenderItems(
      message,
      streaming
    ).map((renderItem) => ({
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
      ? [
          ...contentItems,
          {
            changes,
            kind: 'changes',
            key: `${message.id}-changes`,
            message
          }
        ]
      : contentItems
  })
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
  const openActivities = useRef(new Map<string, boolean>())
  const activityScrollTop = useRef<number | null>(null)
  const [position, setPosition] = useState({
    key: false,
    complete: false,
    escaped: false
  })
  const {
    trackRenderedRange,
    scrollerRef,
    releaseAnchor,
    scrollToBottom: scrollViewportToBottom
  } = useViewportBottomAnchor(active)
  const recentItems = useMemo(() => recentListItems(messages, live), [live, messages])

  useEffect(() => {
    const currentActivityKeys = new Set<string>()
    for (const item of recentItems) {
      if (item.kind === 'content' && item.renderItem && isActivityRenderItem(item.renderItem)) {
        currentActivityKeys.add(item.key)
      }
    }
    for (const key of openActivities.current.keys()) {
      if (!currentActivityKeys.has(key)) openActivities.current.delete(key)
    }
  }, [recentItems])

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
          const message = listItem?.message
          const joinsPrevious =
            message?.role === 'assistant' && item(index - 1)?.message.role === 'assistant'
          const joinsNext =
            message?.role === 'assistant' && item(index + 1)?.message.role === 'assistant'
          return message ? (
            <div
              ref={index === totalCount - 1 ? followGrowingList : undefined}
              className={`mx-auto w-[calc(100%-var(--larify-scrollbar-size))] max-w-4xl min-w-0 translate-x-[calc(var(--larify-scrollbar-size)/2)] px-6 ${listItem.kind === 'changes' ? '' : '[contain:layout_paint_style]'} ${joinsPrevious ? (listItem.kind === 'changes' ? 'pt-4' : 'pt-0') : 'pt-3'} ${joinsNext ? 'pb-0' : index === totalCount - 1 ? 'pb-30' : 'pb-3'}`}
              data-message-index={index}
            >
              {listItem.kind === 'changes' ? (
                <ChangesSummaryCard {...listItem.changes} />
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
