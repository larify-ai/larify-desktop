import { useMemo } from 'react'
import { useChat, type Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { AssistantMessageList } from './message-list'
import { AssistantComposer } from './composer'

export function AssistantChat({ chat }: { chat: Chat<UIMessage> }): React.JSX.Element {
  const { messages, sendMessage, status, stop } = useChat({ chat, throttle: 50 })
  const running = status === 'submitted' || status === 'streaming'
  const history = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'user')
        .map((message) =>
          message.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')
        )
        .filter(Boolean),
    [messages]
  )

  return (
    <div className="flex h-full min-w-0 flex-col">
      <AssistantMessageList messages={messages} live={running} />
      <AssistantComposer
        history={history}
        status={status}
        onSubmit={({ text, files }) => void sendMessage({ text, files })}
        onStop={() => void stop()}
      />
    </div>
  )
}
