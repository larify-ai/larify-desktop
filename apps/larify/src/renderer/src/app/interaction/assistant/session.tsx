import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chat } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import { createIpcTransport } from './transport'
import { readModelConfig } from './model-config'
import { AssistantChat } from './chat'
import type { ConversationHeading } from './conversation-header'
import { loadVisibleMessages, messagePageSize } from './session-messages'
import { createMessageLinkHandler, MessageLinkContextProvider } from './message-links'

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
          onSaved,
          (title) => {
            onHeadingChange({ cwd: transportCwd, title })
            void onSaved().catch(() => undefined)
          }
        )
      }),
      setTransportCwd(next: string) {
        transportCwd = next
      }
    }
  })

  const changeCwd = (next: string): void => {
    setTransportCwd(next)
    onCwdChange(next)
  }

  useEffect(() => {
    setTransportCwd(initialCwd)
  }, [initialCwd, setTransportCwd])

  // 消息正文中的文件/URL 链接处理器，随会话 cwd 与 id 变化而更新。
  const messageLinkHandler = useMemo(
    () => createMessageLinkHandler(initialCwd, id),
    [id, initialCwd]
  )
  useEffect(() => () => messageLinkHandler.dispose(), [messageLinkHandler])

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
      if (pruned) {
        startTransition(() => setOlderMessages(new Map(cache.current)))
      }

      const missingPages: number[] = []
      for (let page = firstPage; page <= lastPage; page++) {
        const pageStart = page * messagePageSize
        if (pageStart >= recentStart || cache.current.has(pageStart) || loading.current.has(page))
          continue
        loading.current.add(page)
        missingPages.push(page)
      }

      for (let index = 0; index < missingPages.length;) {
        const firstMissingPage = missingPages[index]
        let lastMissingPage = firstMissingPage
        while (missingPages[index + 1] === lastMissingPage + 1) {
          lastMissingPage = missingPages[++index]
        }
        index += 1

        const pageStart = firstMissingPage * messagePageSize
        const pageEnd = Math.min((lastMissingPage + 1) * messagePageSize, recentStart)
        void loadVisibleMessages(id, pageStart, pageEnd - pageStart)
          .then((messages) => {
            const active = range.current
            let changed = false
            messages.forEach((message, messageIndex) => {
              const absoluteIndex = pageStart + messageIndex
              const page = Math.floor(absoluteIndex / messagePageSize)
              if (page < active.firstPage || page > active.lastPage) return
              cache.current.set(absoluteIndex, message)
              changed = true
            })
            if (changed) startTransition(() => setOlderMessages(new Map(cache.current)))
          })
          .catch(() => {
            // Keep the page available for retry.
          })
          .finally(() => {
            for (let page = firstMissingPage; page <= lastMissingPage; page++) {
              loading.current.delete(page)
            }
          })
      }
    },
    [id, recentStart]
  )

  return (
    <MessageLinkContextProvider value={messageLinkHandler}>
      <AssistantChat
        active={active}
        chat={chat}
        title={title}
        cwd={initialCwd}
        recentStart={recentStart}
        olderMessages={olderMessages}
        onLoadRange={loadRange}
        onCwdChange={changeCwd}
        onHeadingChange={onHeadingChange}
      />
    </MessageLinkContextProvider>
  )
}
