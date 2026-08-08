import { memo, useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { ArrowDownIcon } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Button } from '@renderer/components/ui/button'
import { MessageView } from './message-view'

const Message = memo(MessageView)

export function AssistantMessageList({
  messages,
  live = false,
  firstItemIndex = 0,
  onLoadOlder
}: {
  messages: UIMessage[]
  live?: boolean
  firstItemIndex?: number
  onLoadOlder?: () => Promise<void>
}): React.JSX.Element {
  const list = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    if (live && atBottom) list.current?.autoscrollToBottom()
  }, [atBottom, live, messages])

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <Virtuoso
        ref={list}
        role="log"
        className="size-full"
        data={messages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(firstItemIndex + messages.length - 1, firstItemIndex)}
        followOutput="auto"
        startReached={onLoadOlder ? () => void onLoadOlder() : undefined}
        atBottomStateChange={setAtBottom}
        computeItemKey={(_, message) => message.id}
        itemContent={(_, message) => (
          <div className="mx-auto w-full px-6 py-3 lg:w-4/5">
            <Message message={message} streaming={live && message.id === messages.at(-1)?.id} />
          </div>
        )}
      />
      {!atBottom && messages.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full dark:bg-background dark:hover:bg-muted"
          aria-label="返回底部"
          onClick={() =>
            list.current?.scrollToIndex({
              index: firstItemIndex + messages.length - 1,
              align: 'end',
              behavior: 'smooth'
            })
          }
        >
          <ArrowDownIcon className="size-4" />
        </Button>
      )}
    </div>
  )
}
