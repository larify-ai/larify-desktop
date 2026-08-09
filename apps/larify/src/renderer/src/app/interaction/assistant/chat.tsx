import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useChat, type Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { AssistantMessageList } from './message-list'
import { AssistantComposer } from './composer'
import type { ConversationHeading } from './conversation-header'
import { ToolOutputContext } from './tool-output'

function messageText(message: UIMessage): string {
  let text = ''
  for (const part of message.parts) if (part.type === 'text') text += part.text
  return text.trim()
}

function inputHistory(messages: UIMessage[]): string[] {
  const history: string[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = messageText(message)
    if (text) history.push(text)
  }
  return history
}

function firstTitle(messages: UIMessage[]): string {
  const message = messages.find(({ role }) => role === 'user')
  return message ? messageText(message).split(/\r?\n/, 1)[0].slice(0, 60) : ''
}

export function AssistantChat({
  chat,
  title,
  cwd,
  initialMessageCount,
  recentStart,
  olderMessages,
  onLoadRange,
  onCwdChange,
  onHeadingChange
}: {
  chat: Chat<UIMessage>
  title?: string
  cwd: string
  initialMessageCount: number
  recentStart: number
  olderMessages: Map<number, UIMessage>
  onLoadRange: (firstPage: number, lastPage: number) => void
  onCwdChange: (cwd: string) => void
  onHeadingChange: (heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const { addToolOutput, messages, sendMessage, status, stop } = useChat({ chat, throttle: 50 })
  const running = status === 'submitted' || status === 'streaming'
  const started = messages.length > 0
  const history = useMemo(() => inputHistory(messages), [messages])
  const titleCreated = useRef(Boolean(title))
  const submitToolOutput = useCallback(
    (tool: string, toolCallId: string, output: unknown) => {
      void addToolOutput({ tool, toolCallId, output })
    },
    [addToolOutput]
  )

  useEffect(() => {
    if (!started || title || titleCreated.current) return
    titleCreated.current = true
    onHeadingChange({ cwd, title: firstTitle(messages) || '未命名任务' })
  }, [cwd, messages, onHeadingChange, started, title])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ToolOutputContext.Provider value={submitToolOutput}>
        <AssistantMessageList
          messages={messages}
          live={running}
          initialMessageCount={initialMessageCount}
          recentStart={recentStart}
          olderMessages={olderMessages}
          onLoadRange={onLoadRange}
        />
      </ToolOutputContext.Provider>
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
