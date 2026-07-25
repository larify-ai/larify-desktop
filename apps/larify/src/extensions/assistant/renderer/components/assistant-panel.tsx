import { memo, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUpIcon, FolderIcon, PlusIcon, SquareIcon } from "lucide-react"
import { Chat, useChat } from "@ai-sdk/react"
import type { FileUIPart, UIMessage } from "ai"
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
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  usePromptInputAttachments,
} from "@renderer/components/ai-elements/prompt-input"
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@renderer/components/ai-elements/attachments"
import { Spinner } from "@renderer/components/ui/spinner"
import { getAgentSessionId, setAgentSessionId } from "@renderer/lib/agent-session"
import { MessageView } from "./message-view"
import { conversationToText } from "../lib/conversation-copy"
import { ipcTransport } from "../lib/transport"

const MemoizedMessageView = memo(MessageView)

type LocalAttachment = FileUIPart & { id: string }

const getPathFilename = (path: string): string => {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

const createDirectoryAttachment = (path: string): LocalAttachment => ({
  filename: getPathFilename(path),
  id: crypto.randomUUID(),
  mediaType: "inode/directory",
  type: "file",
  url: path,
})

const labels = {
  placeholder: "描述任务...",
  add: "添加附件",
  addAttachment: "附件",

  history: "历史任务",
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
  const [sessionId, setSessionIdState] = useState<string>(() => getAgentSessionId())
  const [messagesBySessionId, setMessagesBySessionId] = useState<Record<string, UIMessage[]>>({})
  const messagesBySessionIdRef = useRef(messagesBySessionId)
  const chatsBySessionIdRef = useRef<Record<string, Chat<UIMessage>>>({})
  const selectedSessionIdRef = useRef(sessionId)
  const [sessions, setSessions] = useState<SessionMeta[]>([])

  const setSessionId = (id: string): void => {
    setAgentSessionId(id)
    setSessionIdState(id)
  }

  useEffect(() => {
    messagesBySessionIdRef.current = messagesBySessionId
  }, [messagesBySessionId])

  const cacheSessionMessages = (id: string, messages: UIMessage[]): void => {
    messagesBySessionIdRef.current = {
      ...messagesBySessionIdRef.current,
      [id]: messages,
    }
    setMessagesBySessionId(messagesBySessionIdRef.current)
  }

  const saveSessionMessages = (id: string, messages: UIMessage[]): void => {
    cacheSessionMessages(id, messages)
    void window.bridge
      .invoke("agent:session-save", id, messages)
      .then(() => window.dispatchEvent(new Event("agent:sessions-changed")))
      .catch((error) => console.error("[agent:session-save]", error))
  }

  const createChat = (id: string, messages: UIMessage[]): Chat<UIMessage> => {
    const chat = new Chat<UIMessage>({
      id,
      messages,
      transport: ipcTransport,
      onFinish: ({ messages: finishedMessages }) => saveSessionMessages(id, finishedMessages),
    })
    chatsBySessionIdRef.current[id] = chat
    return chat
  }

  const ensureChat = (id: string, messages: UIMessage[] = []): Chat<UIMessage> => {
    const existing = chatsBySessionIdRef.current[id]
    if (existing) return existing
    return createChat(id, messages)
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
    const existing = chatsBySessionIdRef.current[id]
    const messageCount = existing?.messages.length ?? 0
    const applyLoadedMessages = (messages: UIMessage[]): void => {
      cacheSessionMessages(id, messages)
      const current = chatsBySessionIdRef.current[id]
      if (current) {
        if (current !== existing || current.messages.length !== messageCount) return
        current.messages = messages
        return
      }
      createChat(id, messages)
    }
    try {
      const loaded = await window.bridge.invoke("agent:session-load", id)
      const messages = (loaded as UIMessage[]) ?? []
      applyLoadedMessages(messages)
      return messages
    } catch (error) {
      console.error("[agent:session-load]", error)
      applyLoadedMessages([])
      return []
    }
  }

  useEffect(() => {
    const handleNewSession = (): void => {
      const id = crypto.randomUUID()
      selectedSessionIdRef.current = id
      ensureChat(id, [])
      setSessionId(id)
      cacheSessionMessages(id, [])
    }
    const handleSelectSession = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      if (!id) return
      selectedSessionIdRef.current = id
      if (Object.hasOwn(messagesBySessionIdRef.current, id)) {
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
    void loadSession(sessionId)
    return () => {
      window.removeEventListener("agent:new-session", handleNewSession)
      window.removeEventListener("agent:select-session", handleSelectSession)
      window.removeEventListener("agent:sessions-changed", refreshSessions)
    }
  }, [])

  const chat = ensureChat(sessionId, messagesBySessionId[sessionId] ?? [])

  return (
    <AssistantChat
      key={sessionId}
      chat={chat}
      onSaveSession={saveSessionMessages}
      sessions={sessions}
    />
  )
}

function AttachmentPreviewBar({
  onCountChange,
}: {
  onCountChange: (count: number) => void
}): React.JSX.Element | null {
  const { files, remove } = usePromptInputAttachments()

  useEffect(() => {
    onCountChange(files.length)
  }, [files.length, onCountChange])

  if (files.length === 0) return null
  return (
    <PromptInputHeader className="w-full px-3 pt-3 pb-0">
      <Attachments variant="inline" className="ml-0 w-full">
        {files.map((file) => (
          <Attachment data={file} key={file.id} onRemove={() => remove(file.id)}>
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  )
}

function DirectoryAttachmentMenuItem(): React.JSX.Element {
  const attachments = usePromptInputAttachments()

  const pickDirectories = async (): Promise<void> => {
    const paths = await window.bridge.invoke("dialog:pick-directories")
    if (!Array.isArray(paths)) return
    attachments.addParts(
      paths
        .filter((path): path is string => typeof path === "string" && path.length > 0)
        .map(createDirectoryAttachment),
    )
  }

  return (
    <PromptInputActionMenuItem className="gap-2" onSelect={() => void pickDirectories()}>
      <FolderIcon className="size-4" />
      目录
    </PromptInputActionMenuItem>
  )
}

function AssistantChat({
  chat,
  onSaveSession,
  sessions,
}: {
  chat: Chat<UIMessage>
  onSaveSession: (id: string, messages: UIMessage[]) => void
  sessions: SessionMeta[]
}): React.JSX.Element {
  const { messages, sendMessage, status, stop } = useChat({ chat, throttle: 50 })
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.code === "KeyC") {
        event.preventDefault()
        void navigator.clipboard.writeText(conversationToText(messagesRef.current))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const inputFrameRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLDivElement>(null)
  const pendingInitialSaveRef = useRef(false)
  const submittingRef = useRef(false)
  const stoppingRef = useRef(false)
  const submittedMessageCountRef = useRef(0)
  const [menuMetrics, setMenuMetrics] = useState({
    alignOffset: -12,
    sideOffset: 0,
    width: 320,
  })
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [inputText, setInputText] = useState("")
  const [attachmentCount, setAttachmentCount] = useState(0)
  const isLive = status === "streaming" || status === "submitted"
  const canSubmit = inputText.trim().length > 0 || attachmentCount > 0 || isLive


  useEffect(() => {
    if (isLive) return
    submittingRef.current = false
    stoppingRef.current = false
  }, [isLive])

  useEffect(() => {
    if (!pendingInitialSaveRef.current) return
    if (messages.length <= submittedMessageCountRef.current) return
    pendingInitialSaveRef.current = false
    onSaveSession(chat.id, messages)
  }, [chat.id, messages, onSaveSession])

  const handleSubmit = (message: PromptInputMessage): void => {
    if (isLive || submittingRef.current) return
    const text = message.text.trim()
    const files = message.files
    if (text || files.length > 0) {
      submittingRef.current = true
      setInputText("")
      pendingInitialSaveRef.current = true
      submittedMessageCountRef.current = messages.length
      void sendMessage({ text, files })
    }
  }

  const handleStop = (): void => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    if (messages.length > 0) onSaveSession(chat.id, messages)
    void stop()
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
        multiple
      >
        <AttachmentPreviewBar onCountChange={setAttachmentCount} />
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={labels.placeholder}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            className="max-h-48 min-h-12 overflow-y-auto pl-3"
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
                <PromptInputActionAddAttachments label="文件" />
                <DirectoryAttachmentMenuItem />
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
            onStop={handleStop}
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
            <MemoizedMessageView
              key={m.id}
              message={m}
              streaming={isLive && i === messages.length - 1}
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
