import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUpIcon, PlusIcon, SquareIcon } from "lucide-react"
import { Chat, useChat } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@renderer/components/ai-elements/conversation"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@renderer/components/ai-elements/prompt-input"
import { Spinner } from "@renderer/components/ui/spinner"
import { MessageView } from "./message-view"
import { ipcTransport } from "../lib/transport"
import type { ToolDisplayMeta } from "./message-view"

const labels = {
  placeholder: "描述任务...",
  add: "添加",
  addAttachment: "附件",
  history: "历史",
  noTasks: "暂无任务",
  unnamedTask: "未命名任务",
}

interface SessionMeta {
  id: string
  createdAt: number
  updatedAt: number
  title?: string
}

const formatRelativeTime = (value: number): string => {
  return formatDistanceToNow(value, { addSuffix: true, locale: zhCN })
}

export function AssistantPanel(): React.JSX.Element {
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())
  const [messagesBySessionId, setMessagesBySessionId] = useState<Record<string, UIMessage[]>>({})
  const messagesBySessionIdRef = useRef(messagesBySessionId)
  const chatsBySessionIdRef = useRef<Record<string, Chat<UIMessage>>>({})
  const selectedSessionIdRef = useRef(sessionId)
  const [sessions, setSessions] = useState<SessionMeta[]>([])

  useEffect(() => {
    messagesBySessionIdRef.current = messagesBySessionId
  }, [messagesBySessionId])

  const saveSessionMessages = (id: string, messages: UIMessage[]): void => {
    setMessagesBySessionId((prev) => ({ ...prev, [id]: messages }))
    void window.bridge
      .invoke("agent:session-save", id, messages)
      .then(() => window.dispatchEvent(new Event("agent:sessions-changed")))
      .catch((error) => console.error("[agent:session-save]", error))
  }

  const ensureChat = (id: string, messages: UIMessage[] = []): Chat<UIMessage> => {
    const existing = chatsBySessionIdRef.current[id]
    if (existing) return existing
    const chat = new Chat<UIMessage>({
      id,
      messages,
      transport: ipcTransport,
      onFinish: ({ messages: finishedMessages }) => saveSessionMessages(id, finishedMessages),
    })
    chatsBySessionIdRef.current[id] = chat
    return chat
  }

  const refreshSessions = async (): Promise<void> => {
    try {
      const rows = await window.bridge.invoke("agent:session-list")
      setSessions(rows as SessionMeta[])
    } catch (error) {
      console.error("[agent:session-list]", error)
    }
  }

  const loadSession = async (id: string): Promise<UIMessage[]> => {
    try {
      const loaded = await window.bridge.invoke("agent:session-load", id)
      const messages = (loaded as UIMessage[]) ?? []
      setMessagesBySessionId((prev) => ({ ...prev, [id]: messages }))
      ensureChat(id, messages)
      return messages
    } catch (error) {
      console.error("[agent:session-load]", error)
      setMessagesBySessionId((prev) => ({ ...prev, [id]: [] }))
      ensureChat(id, [])
      return []
    }
  }

  useEffect(() => {
    const handleNewSession = (): void => {
      const id = crypto.randomUUID()
      selectedSessionIdRef.current = id
      ensureChat(id, [])
      setSessionId(id)
      setMessagesBySessionId((prev) => ({ ...prev, [id]: [] }))
    }
    const handleSelectSession = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      if (!id) return
      selectedSessionIdRef.current = id
      if (chatsBySessionIdRef.current[id]) {
        setSessionId(id)
        return
      }
      void loadSession(id).then(() => {
        if (selectedSessionIdRef.current === id) setSessionId(id)
      })
    }

    window.addEventListener("agent:new-session", handleNewSession)
    window.addEventListener("agent:select-session", handleSelectSession)
    window.addEventListener("agent:sessions-changed", refreshSessions)
    void refreshSessions()
    return () => {
      window.removeEventListener("agent:new-session", handleNewSession)
      window.removeEventListener("agent:select-session", handleSelectSession)
      window.removeEventListener("agent:sessions-changed", refreshSessions)
    }
  }, [])

  const chat = ensureChat(sessionId, messagesBySessionId[sessionId] ?? [])

  return (
    <AssistantChat
      chat={chat}
      sessions={sessions}
    />
  )
}

function AssistantChat({
  chat,
  sessions,
}: {
  chat: Chat<UIMessage>
  sessions: SessionMeta[]
}): React.JSX.Element {
  const { messages, sendMessage, status, stop } = useChat({ chat })
  const [toolDisplays, setToolDisplays] = useState<Record<string, ToolDisplayMeta>>({})
  const inputFrameRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLDivElement>(null)
  const [menuMetrics, setMenuMetrics] = useState({
    alignOffset: -12,
    sideOffset: 0,
    width: 320,
  })
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [inputText, setInputText] = useState("")
  const isLive = status === "streaming" || status === "submitted"
  const canSubmit = inputText.trim().length > 0 || isLive

  const refreshToolDisplays = async (): Promise<void> => {
    try {
      const displays = await window.bridge.invoke("agent:tool-displays")
      setToolDisplays(displays as Record<string, ToolDisplayMeta>)
    } catch (error) {
      console.error("[agent:tool-displays]", error)
    }
  }

  useEffect(() => {
    void refreshToolDisplays()
  }, [])

  const handleSubmit = (message: PromptInputMessage): void => {
    const text = message.text.trim()
    if (text) {
      setInputText("")
      void refreshToolDisplays().finally(() => void sendMessage({ text }))
    }
  }

  const selectSession = (id: string): void => {
    window.dispatchEvent(new CustomEvent("agent:select-session", { detail: id }))
  }

  useLayoutEffect(() => {
    const measure = (): void => {
      const frame = inputFrameRef.current?.getBoundingClientRect()
      const trigger = menuTriggerRef.current?.getBoundingClientRect()
      if (!frame || !trigger) return
      setMenuMetrics({
        alignOffset: Math.round(frame.left - trigger.left),
        sideOffset: Math.max(0, Math.round(trigger.top - frame.top)),
        width: Math.round(frame.width),
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    if (inputFrameRef.current) observer.observe(inputFrameRef.current)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  const input = (
    <div className="mx-auto w-full max-w-3xl px-6 pb-4">
      <div ref={inputFrameRef} className="w-full">
      <PromptInput
        onSubmit={handleSubmit}
        className="[&_[data-slot=input-group]]:rounded-2xl"
      >
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={labels.placeholder}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            className="max-h-48 min-h-12 pl-3"
          />
        </PromptInputBody>
        <PromptInputFooter className="justify-between">
          <PromptInputTools>
            <PromptInputActionMenu open={actionMenuOpen} onOpenChange={setActionMenuOpen}>
              <div ref={menuTriggerRef}>
                <PromptInputActionMenuTrigger
                  style={{ borderRadius: 9999 }}
                  className="border border-transparent bg-secondary text-secondary-foreground hover:border-border hover:bg-muted hover:text-foreground data-[state=open]:border-border data-[state=open]:bg-muted data-[state=open]:text-foreground focus-visible:border-transparent focus-visible:ring-0"
                >
                  <PlusIcon className="size-4" />
                </PromptInputActionMenuTrigger>
              </div>
              <PromptInputActionMenuContent
                side="top"
                align="start"
                sideOffset={menuMetrics.sideOffset + 4}
                alignOffset={menuMetrics.alignOffset}
                className="rounded-2xl shadow-none"
                style={{ width: menuMetrics.width }}
              >
                <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  {labels.add}
                </div>
                <PromptInputActionAddAttachments label={labels.addAttachment} />
                <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  {labels.history}
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {sessions.length === 0 ? (
                    <PromptInputActionMenuItem disabled>
                      {labels.noTasks}
                    </PromptInputActionMenuItem>
                  ) : (
                    sessions.map((session) => (
                      <PromptInputActionMenuItem
                        key={session.id}
                        onSelect={() => selectSession(session.id)}
                        className="gap-2"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {session.title || labels.unnamedTask}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                      </PromptInputActionMenuItem>
                    ))
                  )}
                </div>
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          </PromptInputTools>
          <PromptInputSubmit
            status={status}
            onStop={() => void stop()}
            disabled={!canSubmit}
            className="rounded-full"
          >
            {isLive ? <SquareIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <Conversation className="min-w-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl px-6">
          {messages.map((m, i) => (
            <MessageView
              key={m.id}
              message={m}
              streaming={isLive && i === messages.length - 1}
              toolDisplays={toolDisplays}
            />
          ))}
          {status === "submitted" && <Spinner className="text-muted-foreground" />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {input}
    </div>
  )
}
