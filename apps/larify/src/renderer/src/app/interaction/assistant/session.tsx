import { useCallback, useRef, useState } from 'react'
import { Chat } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import { createIpcTransport } from './transport'
import { readModelConfig } from './model-config'
import { AssistantChat } from './chat'
import type { ConversationHeading } from './conversation-header'
import { loadVisibleMessages, messagePageSize } from './session-messages'

export function AssistantSession({
  id,
  active = true,
  title,
  initialMessages,
  initialMessageCount,
  initialCwd,
  onCwdChange,
  onHeadingChange,
  onSaved
}: {
  id: string
  active?: boolean
  title?: string
  initialMessages: UIMessage[]
  initialMessageCount: number
  initialCwd: string
  onCwdChange: (cwd: string) => void
  onHeadingChange: (heading: ConversationHeading | null) => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [cwd, setCwd] = useState(initialCwd)
  const recentStart = Math.max(0, initialMessageCount - initialMessages.length)
  const cache = useRef(new Map<number, UIMessage>())
  const [olderMessages, setOlderMessages] = useState(() => new Map<number, UIMessage>())
  const loading = useRef(new Set<number>())
  const range = useRef({ firstPage: 0, lastPage: -1 })
  const [{ chat, setTransportCwd }] = useState(() => {
    let transportCwd = initialCwd
    return {
      chat: new Chat<UIMessage>({
        id,
        messages: initialMessages,
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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

  const changeCwd = (next: string): void => {
    setTransportCwd(next)
    setCwd(next)
    onCwdChange(next)
  }

  const loadRange = useCallback(
    (firstPage: number, lastPage: number) => {
      range.current = { firstPage, lastPage }

      let pruned = false
      for (const index of cache.current.keys()) {
        const page = Math.floor(index / messagePageSize)
        if (page < firstPage || page > lastPage) {
          cache.current.delete(index)
          pruned = true
        }
      }
      if (pruned) setOlderMessages(new Map(cache.current))

      for (let page = firstPage; page <= lastPage; page++) {
        const pageStart = page * messagePageSize
        const pageEnd = Math.min(pageStart + messagePageSize, recentStart)
        if (pageEnd <= pageStart || cache.current.has(pageStart) || loading.current.has(page)) {
          continue
        }

        loading.current.add(page)
        void loadVisibleMessages(id, pageStart, pageEnd - pageStart)
          .then((messages) => {
            const active = range.current
            if (page < active.firstPage || page > active.lastPage) return
            messages.forEach((message, index) => cache.current.set(pageStart + index, message))
            setOlderMessages(new Map(cache.current))
          })
          .catch(() => {
            // Keep the page available for retry.
          })
          .finally(() => loading.current.delete(page))
      }
    },
    [id, recentStart]
  )

  return (
    <AssistantChat
      active={active}
      chat={chat}
      title={title}
      cwd={cwd}
      recentStart={recentStart}
      olderMessages={olderMessages}
      onLoadRange={loadRange}
      onCwdChange={changeCwd}
      onHeadingChange={onHeadingChange}
    />
  )
}
