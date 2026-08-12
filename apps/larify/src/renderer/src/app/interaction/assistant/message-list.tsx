import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { ArrowDownIcon } from 'lucide-react'
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso'
import { Button } from '@renderer/components/ui/button'
import { MessageView } from './message-view'
import { messagePageSize } from './session-messages'
import { useViewportBottomAnchor } from './use-viewport-bottom-anchor'

const Message = memo(MessageView)
const pageBuffer = 1
const estimatedMessageHeight = 80
const leaveBottomThreshold = 32
const returnBottomThreshold = 16
type ScrollMode = 'positioning' | 'following' | 'reading'

function ScrollPlaceholder({
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

export function AssistantMessageList({
  active = true,
  messages,
  live = false,
  recentStart,
  olderMessages,
  onLoadRange
}: {
  active?: boolean
  messages: UIMessage[]
  live?: boolean
  recentStart: number
  olderMessages: Map<number, UIMessage>
  onLoadRange: (firstPage: number, lastPage: number) => void
}): React.JSX.Element {
  const list = useRef<VirtuosoHandle>(null)
  const scrollMode = useRef<ScrollMode>('positioning')
  const scrollElement = useRef<HTMLElement | null>(null)
  const lastScrollTop = useRef(0)
  const resizingMessage = useRef(false)
  const resizeVersion = useRef(0)
  const scrollIntentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const positioningStarted = useRef(false)
  const [position, setPosition] = useState({
    key: false,
    complete: false,
    escaped: false
  })
  const {
    captureAnchor,
    scrollerRef,
    scrollToBottom: scrollViewportToBottom
  } = useViewportBottomAnchor(active)

  const handleScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      scrollerRef(element)
      scrollElement.current = element instanceof HTMLElement ? element : null
      lastScrollTop.current = scrollElement.current?.scrollTop ?? 0
    },
    [scrollerRef]
  )

  useEffect(() => {
    if (live && scrollMode.current === 'following') list.current?.autoscrollToBottom()
  }, [live, messages])

  useEffect(
    () => () => {
      if (scrollIntentTimer.current !== null) clearTimeout(scrollIntentTimer.current)
    },
    []
  )

  const followGrowingMessage = useCallback((element: HTMLDivElement | null) => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const version = ++resizeVersion.current
      resizingMessage.current = true
      if (scrollMode.current === 'following') list.current?.autoscrollToBottom()
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (resizeVersion.current === version) resizingMessage.current = false
        }, 1)
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const totalCount = recentStart + messages.length
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
    setPosition((current) => {
      const sameKey = current.key === positioningKey
      const next = {
        key: positioningKey,
        complete: sameKey ? current.complete || nextAtBottom : nextAtBottom,
        escaped: nextAtBottom ? false : sameKey && current.escaped
      }
      return current.key === next.key &&
        current.complete === next.complete &&
        current.escaped === next.escaped
        ? current
        : next
    })
    if (nextAtBottom) {
      scrollMode.current = 'following'
    } else if (scrollMode.current === 'positioning') {
      list.current?.autoscrollToBottom()
      scrollViewportToBottom()
    }
  }
  const item = (index: number): UIMessage | undefined =>
    index < recentStart ? olderMessages.get(index) : messages[index - recentStart]
  const rangeChanged = ({ startIndex, endIndex }: ListRange): void => {
    captureAnchor({ startIndex, endIndex })
    if (recentStart <= 0) return
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
        if (movedUp && scrollMode.current === 'following') {
          if (scrollIntentTimer.current !== null) clearTimeout(scrollIntentTimer.current)
          scrollIntentTimer.current = setTimeout(() => {
            scrollIntentTimer.current = null
            if (
              !resizingMessage.current &&
              scrollElement.current === element &&
              scrollMode.current === 'following' &&
              element.scrollTop <= scrollTop &&
              element.scrollHeight - element.clientHeight - element.scrollTop >=
                leaveBottomThreshold
            ) {
              scrollMode.current = 'reading'
              setPosition((current) =>
                current.key === positioningKey ? { ...current, escaped: true } : current
              )
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
        increaseViewportBy={{ top: 600, bottom: 600 }}
        followOutput="auto"
        rangeChanged={rangeChanged}
        atBottomStateChange={handleAtBottomChange}
        computeItemKey={(index) => item(index)?.id ?? index}
        itemContent={(index) => {
          const message = item(index)
          return message ? (
            <div
              ref={live && index === totalCount - 1 ? followGrowingMessage : undefined}
              className={`mx-auto w-full max-w-4xl min-w-0 px-6 pt-3 ${index === totalCount - 1 ? 'pb-30' : 'pb-3'}`}
              data-message-index={index}
            >
              <Message message={message} streaming={live && message.id === messages.at(-1)?.id} />
            </div>
          ) : (
            <ScrollPlaceholder height={estimatedMessageHeight} index={index} />
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
