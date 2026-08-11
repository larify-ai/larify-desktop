import { memo, useEffect, useRef, useState } from 'react'
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

function MessageListFooter(): React.JSX.Element {
  return <div className="h-30" aria-hidden="true" />
}

export function AssistantMessageList({
  messages,
  live = false,
  initialMessageCount,
  recentStart,
  olderMessages,
  onLoadRange
}: {
  messages: UIMessage[]
  live?: boolean
  initialMessageCount: number
  recentStart: number
  olderMessages: Map<number, UIMessage>
  onLoadRange: (firstPage: number, lastPage: number) => void
}): React.JSX.Element {
  const list = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  const { captureAnchor, scrollerRef } = useViewportBottomAnchor()

  useEffect(() => {
    if (live && atBottom) list.current?.autoscrollToBottom()
  }, [atBottom, live, messages])

  const totalCount = recentStart + messages.length
  const scrollToBottom = (): void => {
    list.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER })
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
    <div className="relative min-h-0 min-w-0 flex-1">
      <Virtuoso
        ref={list}
        scrollerRef={scrollerRef}
        role="log"
        className="size-full [scrollbar-gutter:stable]"
        totalCount={totalCount}
        defaultItemHeight={estimatedMessageHeight}
        initialItemCount={Math.min(12, totalCount)}
        initialTopMostItemIndex={Math.max(initialMessageCount - 1, 0)}
        increaseViewportBy={{ top: 600, bottom: 600 }}
        components={{ Footer: MessageListFooter }}
        followOutput="auto"
        rangeChanged={rangeChanged}
        atBottomStateChange={setAtBottom}
        computeItemKey={(index) => item(index)?.id ?? index}
        itemContent={(index) => {
          const message = item(index)
          return message ? (
            <div className="mx-auto w-full max-w-4xl min-w-0 px-6 py-3" data-message-index={index}>
              <Message message={message} streaming={live && message.id === messages.at(-1)?.id} />
            </div>
          ) : (
            <ScrollPlaceholder height={estimatedMessageHeight} index={index} />
          )
        }}
      />
      {!atBottom && messages.length > 0 && (
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
