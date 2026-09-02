import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chat } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import type { AgentModelConfig } from '../../../../../main/core/model/config'
import { createIpcTransport } from './transport'
import {
  ModelConfigContext,
  readSessionModelConfig,
  writeModelConfig,
  writeSessionModelConfig
} from './model-config'
import { AssistantChat } from './chat'
import type { ConversationHeading } from './conversation-header'
import {
  loadSessionNavigation,
  loadVisibleMessages,
  messagePageSize,
  type SessionNavigationItem
} from './session-messages'
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
  // 会话级模型配置：state 驱动 ModelSelector 显示；ref 镜像最新选择，
  // 供 transport 发送时读取（transport 闭包在 useState 初始化时创建，
  // 无法捕获最新的 state，故用 ref 保证"所见即所发"）。
  const modelConfigRef = useRef<AgentModelConfig>(readSessionModelConfig(id, localStorage))
  const [modelConfig, setModelConfigState] = useState<AgentModelConfig>(modelConfigRef.current)
  const updateModelConfig = useCallback((next: AgentModelConfig): void => {
    modelConfigRef.current = next
    setModelConfigState(next)
    // 点选即固化：同时写入该会话 key（供回显）与全局默认值（供新建会话沿用）。
    if (typeof localStorage !== 'undefined') {
      writeSessionModelConfig(id, localStorage, next)
      writeModelConfig(localStorage, next)
    }
  }, [id])
  const recentStart = Math.max(0, initialMessageCount - initialMessages.length)
  const cache = useRef(new Map<number, UIMessage>())
  const [olderMessages, setOlderMessages] = useState(() => new Map<number, UIMessage>())
  const [navigationItems, setNavigationItems] = useState<SessionNavigationItem[]>([])
  const navigationLoading = useRef(false)
  const loading = useRef(new Set<number>())
  const [{ chat, setTransportCwd }] = useState(() => {
    let transportCwd = initialCwd
    return {
      chat: new Chat<UIMessage>({
        id,
        messages: initialMessages,
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
        transport: createIpcTransport(
          () => transportCwd,
          () => modelConfigRef.current,
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

  useEffect(() => {
    let current = true
    void loadSessionNavigation(id, initialMessageCount)
      .then((items) => {
        if (current) setNavigationItems(items)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [id, initialMessageCount])

  const loadOlderNavigation = useCallback(() => {
    const beforeIndex = navigationItems[0]?.index
    if (!beforeIndex || navigationLoading.current) return
    navigationLoading.current = true
    void loadSessionNavigation(id, beforeIndex)
      .then((items) => {
        if (!items.length) return
        setNavigationItems((current) => {
          const ids = new Set(current.map((item) => item.id))
          return [...items.filter((item) => !ids.has(item.id)), ...current]
        })
      })
      .catch(() => undefined)
      .finally(() => {
        navigationLoading.current = false
      })
  }, [id, navigationItems])

  // 消息正文中的文件/URL 链接处理器，随会话 cwd 与 id 变化而更新。
  const messageLinkHandler = useMemo(
    () => createMessageLinkHandler(initialCwd, id),
    [id, initialCwd]
  )
  useEffect(() => () => messageLinkHandler.dispose(), [messageLinkHandler])

  const loadRange = useCallback(
    (firstPage: number, lastPage: number) => {
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
            messages.forEach((message, messageIndex) => {
              const absoluteIndex = pageStart + messageIndex
              cache.current.set(absoluteIndex, message)
            })
            setOlderMessages(new Map(cache.current))
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
      <ModelConfigContext.Provider value={{ value: modelConfig, onChange: updateModelConfig }}>
        <AssistantChat
          active={active}
          chat={chat}
          title={title}
          cwd={initialCwd}
          recentStart={recentStart}
          olderMessages={olderMessages}
          navigationItems={navigationItems}
          onLoadOlderNavigation={loadOlderNavigation}
          onLoadRange={loadRange}
          onCwdChange={changeCwd}
          onHeadingChange={onHeadingChange}
        />
      </ModelConfigContext.Provider>
    </MessageLinkContextProvider>
  )
}
