import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat, type Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { AssistantMessageList } from './message-list'
import { AssistantComposer } from './composer'
import type { ConversationHeading } from './conversation-header'
import { ToolOutputContext } from './tool-output'
import { sessionAttentionState, useSessionAttentionReport } from './session-attention'

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
  active = true,
  chat,
  title,
  cwd,
  recentStart,
  olderMessages,
  onLoadRange,
  onCwdChange,
  onHeadingChange
}: {
  active?: boolean
  chat: Chat<UIMessage>
  title?: string
  cwd: string
  recentStart: number
  olderMessages: Map<number, UIMessage>
  onLoadRange: (firstPage: number, lastPage: number) => void
  onCwdChange: (cwd: string) => void
  onHeadingChange: (heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const { addToolOutput, messages, sendMessage, setMessages, status, stop } = useChat({
    chat,
    throttle: 50
  })
  const running = status === 'submitted' || status === 'streaming'
  const attentionState = sessionAttentionState(status, messages)
  const reportAttentionState = useSessionAttentionReport()
  const started = messages.length > 0
  const history = useMemo(() => inputHistory(messages), [messages])
  const titleCreated = useRef(Boolean(title))
  const runStartedAt = useRef<number | undefined>(undefined)
  const [followRequest, setFollowRequest] = useState(0)
  const submitToolOutput = useCallback(
    (tool: string, toolCallId: string, output: unknown) => {
      runStartedAt.current = Date.now()
      setFollowRequest((current) => current + 1)
      void addToolOutput({ tool, toolCallId, output })
    },
    [addToolOutput]
  )
  const markAborted = useCallback(
    (completedAt: number) => {
      setMessages((current) => {
        const lastUserIndex = current.findLastIndex(({ role }) => role === 'user')
        const index = current.findLastIndex(
          ({ role }, messageIndex) => role === 'assistant' && messageIndex > lastUserIndex
        )
        if (index < 0) return current
        const next = [...current]
        const message = current[index]
        const metadata = (message.metadata ?? {}) as Record<string, unknown>
        const currentRunStartedAt = runStartedAt.current
        const alreadyTerminal =
          typeof metadata.completedAt === 'number' &&
          (currentRunStartedAt === undefined || metadata.completedAt >= currentRunStartedAt)
        if (alreadyTerminal) return current
        next[index] = {
          ...message,
          metadata: {
            ...metadata,
            startedAt:
              typeof metadata.startedAt === 'number' &&
              (currentRunStartedAt === undefined || metadata.startedAt >= currentRunStartedAt)
                ? metadata.startedAt
                : (runStartedAt.current ?? completedAt),
            completedAt,
            outcome: 'aborted'
          }
        }
        return next
      })
    },
    [setMessages]
  )
  const stopAndMarkAborted = useCallback(async () => {
    const completedAt = Date.now()
    markAborted(completedAt)
    await stop()
  }, [markAborted, stop])

  useEffect(() => {
    if (!started || title || titleCreated.current) return
    titleCreated.current = true
    onHeadingChange({ cwd, title: firstTitle(messages) || '未命名任务' })
  }, [cwd, messages, onHeadingChange, started, title])

  useEffect(() => {
    reportAttentionState(chat.id, attentionState)
  }, [attentionState, chat.id, reportAttentionState])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ToolOutputContext.Provider value={submitToolOutput}>
        <AssistantMessageList
          active={active}
          messages={messages}
          live={running}
          followRequest={followRequest}
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
        onSubmit={({ text, files }) => {
          runStartedAt.current = Date.now()
          void sendMessage({ text, files })
        }}
        onStop={() => void stopAndMarkAborted()}
      />
    </div>
  )
}
