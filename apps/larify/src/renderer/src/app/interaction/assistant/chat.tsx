import { useEffect, useMemo } from 'react'
import { useChat, type Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { AssistantMessageList } from './message-list'
import { AssistantComposer } from './composer'
import type { ConversationHeading } from './conversation-header'

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim()
}

export function AssistantChat({
  chat,
  cwd,
  onCwdChange,
  onHeadingChange
}: {
  chat: Chat<UIMessage>
  cwd: string
  onCwdChange: (cwd: string) => void
  onHeadingChange: (heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const { messages, sendMessage, status, stop } = useChat({ chat, throttle: 50 })
  const running = status === 'submitted' || status === 'streaming'
  const started = messages.length > 0
  const history = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'user')
        .map(messageText)
        .filter(Boolean),
    [messages]
  )
  const title = history[0]?.split(/\r?\n/, 1)[0].slice(0, 60) ?? '新任务'

  useEffect(() => {
    onHeadingChange(started ? { cwd, title } : null)
  }, [cwd, onHeadingChange, started, title])

  useEffect(() => {
    return () => onHeadingChange(null)
  }, [onHeadingChange])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <AssistantMessageList messages={messages} live={running} />
      <AssistantComposer
        cwd={cwd}
        history={history}
        status={status}
        showWorkspace={!started}
        onCwdChange={onCwdChange}
        onSubmit={({ text, files }) => void sendMessage({ text, files })}
        onStop={() => void stop()}
      />
    </div>
  )
}
