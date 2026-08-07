import { memo } from 'react'
import type { UIMessage } from 'ai'
import { Virtuoso } from 'react-virtuoso'
import { MessageView } from './message-view'

const Message = memo(MessageView)

export function AssistantMessageList({
  messages,
  live = false
}: {
  messages: UIMessage[]
  live?: boolean
}): React.JSX.Element {
  return (
    <Virtuoso
      className="min-h-0 min-w-0 flex-1"
      data={messages}
      initialTopMostItemIndex={Math.max(messages.length - 1, 0)}
      followOutput="auto"
      computeItemKey={(_, message) => message.id}
      itemContent={(index, message) => (
        <div className="mx-auto w-full max-w-3xl px-6 py-3">
          <Message message={message} streaming={live && index === messages.length - 1} />
        </div>
      )}
    />
  )
}
