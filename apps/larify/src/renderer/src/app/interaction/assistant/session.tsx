import { useCallback, useRef, useState } from 'react'
import { Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { createIpcTransport } from './transport'
import { readModelConfig } from './model-config'
import { AssistantChat } from './chat'
import type { ConversationHeading } from './conversation-header'
import { loadMessagePage } from './session-messages'

const initialListIndex = 1_000_000

export function AssistantSession({
  id,
  title,
  initialMessages,
  initialHasMore,
  initialCwd,
  onHeadingChange,
  onSaved
}: {
  id: string
  title?: string
  initialMessages: UIMessage[]
  initialHasMore: boolean
  initialCwd: string
  onHeadingChange: (heading: ConversationHeading | null) => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [cwd, setCwd] = useState(initialCwd)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [firstItemIndex, setFirstItemIndex] = useState(initialListIndex)
  const loading = useRef(false)
  const [{ chat, setTransportCwd }] = useState(() => {
    let transportCwd = initialCwd
    return {
      chat: new Chat<UIMessage>({
        id,
        messages: initialMessages,
        transport: createIpcTransport(
          () => transportCwd,
          () => readModelConfig(localStorage),
          onSaved
        )
      }),
      setTransportCwd(next: string) {
        transportCwd = next
      }
    }
  })
  const chatRef = useRef(chat)

  const changeCwd = (next: string): void => {
    setTransportCwd(next)
    setCwd(next)
  }

  const loadOlder = useCallback(async () => {
    if (!hasMore || loading.current) return
    loading.current = true
    try {
      const page = await loadMessagePage(id, chatRef.current.messages.length)
      if (page.messages.length) {
        chatRef.current.messages = [...page.messages, ...chatRef.current.messages]
        setFirstItemIndex((index) => index - page.messages.length)
      }
      setHasMore(page.hasMore)
    } catch {
      // Keep older messages available for retry.
    } finally {
      loading.current = false
    }
  }, [hasMore, id])

  return (
    <AssistantChat
      chat={chat}
      title={title}
      cwd={cwd}
      firstItemIndex={firstItemIndex}
      onLoadOlder={hasMore ? loadOlder : undefined}
      onCwdChange={changeCwd}
      onHeadingChange={onHeadingChange}
    />
  )
}
