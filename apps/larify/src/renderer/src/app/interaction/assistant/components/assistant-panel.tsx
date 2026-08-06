import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderClockIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PlusIcon,
  SquareIcon
} from 'lucide-react'
import { Chat, useChat } from '@ai-sdk/react'
import type { FileUIPart, UIMessage } from 'ai'
import { Virtuoso } from 'react-virtuoso'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
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
  usePromptInputAttachments
} from '@renderer/components/ai-elements/prompt-input'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments
} from '@renderer/components/ai-elements/attachments'
import { DropdownMenuSeparator } from '@renderer/components/ui/dropdown-menu'
import {
  getAgentSessionId,
  setAgentSessionCwd,
  setAgentSessionId
} from '@renderer/lib/agent-session'
import { MessageView } from './message-view'
import { conversationToText } from '../lib/conversation-copy'
import { createIpcTransport } from '../lib/transport'
import { RunActivity } from './run-activity'
import { toggleSessionGroup } from '../lib/session-groups'
import { readModelConfig, writeModelConfig } from '../lib/model-config'
import {
  modelIds,
  modelLabels,
  type AgentModelConfig
} from '../../../../../../extensions/agent/shared/model'

const MemoizedMessageView = memo(MessageView)
const RECENT_CWDS_KEY = 'larify.recentCwds'
const MAX_RECENT_CWDS = 5
const MAX_SESSIONS_PER_CWD = 5
type LocalAttachment = FileUIPart & { id: string }
const storage: Pick<Storage, 'getItem' | 'setItem'> =
  typeof globalThis.localStorage === 'undefined'
    ? { getItem: () => null, setItem: () => undefined }
    : globalThis.localStorage

const getPathFilename = (path: string): string => {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

const createDirectoryAttachment = (path: string): LocalAttachment => ({
  filename: getPathFilename(path),
  id: crypto.randomUUID(),
  mediaType: 'inode/directory',
  type: 'file',
  url: path
})

const labels = {
  placeholder: '描述任务...',
  add: '添加附件',
  addAttachment: '附件',
  workspace: '工作目录',
  history: '历史任务',
  noTasks: '暂无任务',
  unnamedTask: '未命名任务'
}

interface SessionMeta {
  id: string
  cwd?: string
  createdAt: number
  updatedAt: number
  title?: string
}

const readRecentCwds = (): string[] => {
  try {
    const value = JSON.parse(storage.getItem(RECENT_CWDS_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const formatRelativeTime = (value: number): string => {
  return formatDistanceToNow(value, { addSuffix: true, locale: zhCN })
}

export function AssistantPanel(): React.JSX.Element {
  const [sessionId, setSessionIdState] = useState<string>(() => getAgentSessionId())
  const [messagesBySessionId, setMessagesBySessionId] = useState<Record<string, UIMessage[]>>({})
  const messagesBySessionIdRef = useRef(messagesBySessionId)
  const [cwdBySessionId, setCwdBySessionId] = useState<Record<string, string>>({})
  const cwdBySessionIdRef = useRef(cwdBySessionId)
  const cwdRevisionRef = useRef<Record<string, number>>({})
  const defaultCwdRef = useRef('')
  const [defaultCwd, setDefaultCwd] = useState('')
  const [recentCwds, setRecentCwds] = useState<string[]>(readRecentCwds)
  const recentCwdsRef = useRef(recentCwds)
  const chatsBySessionIdRef = useRef<Record<string, Chat<UIMessage>>>({})
  const selectedSessionIdRef = useRef(sessionId)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [modelConfig, setModelConfigState] = useState<AgentModelConfig>(() =>
    readModelConfig(storage)
  )
  const modelConfigRef = useRef(modelConfig)

  const setModelConfig = (value: AgentModelConfig): void => {
    modelConfigRef.current = value
    setModelConfigState(value)
    try {
      writeModelConfig(storage, value)
    } catch {
      return
    }
  }

  const setSessionId = (id: string): void => {
    setAgentSessionId(id)
    setAgentSessionCwd(cwdBySessionIdRef.current[id] ?? '')
    setSessionIdState(id)
  }

  useEffect(() => {
    messagesBySessionIdRef.current = messagesBySessionId
  }, [messagesBySessionId])

  const cacheSessionMessages = (id: string, messages: UIMessage[]): void => {
    messagesBySessionIdRef.current = {
      ...messagesBySessionIdRef.current,
      [id]: messages
    }
    setMessagesBySessionId(messagesBySessionIdRef.current)
  }

  const cacheSessionCwd = (id: string, cwd: string): void => {
    cwdBySessionIdRef.current = { ...cwdBySessionIdRef.current, [id]: cwd }
    setCwdBySessionId(cwdBySessionIdRef.current)
    if (selectedSessionIdRef.current === id) setAgentSessionCwd(cwd)
  }

  const rememberRecentCwd = (cwd: string): void => {
    if (!cwd) return
    const defaultCwd = defaultCwdRef.current
    const ordered = [cwd, ...recentCwdsRef.current.filter((item) => item !== cwd)]
    const regular = ordered.filter((item) => item !== defaultCwd)
    const next =
      defaultCwd && ordered.includes(defaultCwd)
        ? [...regular.slice(0, MAX_RECENT_CWDS - 1), defaultCwd]
        : regular.slice(0, MAX_RECENT_CWDS)
    recentCwdsRef.current = next
    setRecentCwds(next)
    try {
      storage.setItem(RECENT_CWDS_KEY, JSON.stringify(next))
    } catch {
      return
    }
  }

  const selectSessionCwd = (id: string, cwd: string): void => {
    cwdRevisionRef.current[id] = (cwdRevisionRef.current[id] ?? 0) + 1
    cacheSessionCwd(id, cwd)
    rememberRecentCwd(cwd)
  }

  const saveSessionMessages = (id: string, messages: UIMessage[], cwd: string): void => {
    cacheSessionMessages(id, messages)
    void window.bridge
      .invoke('agent:session-save', id, messages, cwd)
      .then(() => window.dispatchEvent(new Event('agent:sessions-changed')))
      .catch((error) => console.error('[agent:session-save]', error))
  }

  const createChat = (id: string, messages: UIMessage[]): Chat<UIMessage> => {
    const chat = new Chat<UIMessage>({
      id,
      messages,
      transport: createIpcTransport(
        () => cwdBySessionIdRef.current[id] ?? '',
        () => modelConfigRef.current
      ),
      onFinish: ({ messages: finishedMessages }) =>
        saveSessionMessages(id, finishedMessages, cwdBySessionIdRef.current[id] ?? '')
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
      const cwd = cwdBySessionIdRef.current[selectedSessionIdRef.current]
      if (!cwd) return
      const rows = await window.bridge.invoke('agent:session-list', cwd)
      setSessions(rows as SessionMeta[])
    } catch (error) {
      console.error('[agent:session-list]', error)
    }
  }

  const loadSession = async (
    id: string
  ): Promise<{ messages: UIMessage[]; cwd: string; defaultCwd: string }> => {
    const cwdRevision = cwdRevisionRef.current[id] ?? 0
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
      const loaded = (await window.bridge.invoke('agent:session-load', id)) as {
        messages: UIMessage[]
        cwd: string
        defaultCwd: string
      }
      const result = loaded ?? { messages: [], cwd: '', defaultCwd: '' }
      defaultCwdRef.current = result.defaultCwd
      setDefaultCwd(result.defaultCwd)
      rememberRecentCwd(result.defaultCwd)
      const cwd =
        result.messages.length === 0 ? (recentCwdsRef.current[0] ?? result.cwd) : result.cwd
      applyLoadedMessages(result.messages)
      if ((cwdRevisionRef.current[id] ?? 0) === cwdRevision) {
        cacheSessionCwd(id, cwd)
        rememberRecentCwd(cwd)
      }
      return { ...result, cwd }
    } catch (error) {
      console.error('[agent:session-load]', error)
      applyLoadedMessages([])
      return { messages: [], cwd: '', defaultCwd: defaultCwdRef.current }
    }
  }

  useEffect(() => {
    const handleNewSession = (): void => {
      const id = crypto.randomUUID()
      const previousSessionId = selectedSessionIdRef.current
      selectedSessionIdRef.current = id
      const cwd = recentCwdsRef.current[0] ?? cwdBySessionIdRef.current[previousSessionId]
      if (!cwd) {
        void loadSession(id).then(() => {
          if (selectedSessionIdRef.current === id) setSessionId(id)
        })
        return
      }
      cacheSessionMessages(id, [])
      cacheSessionCwd(id, cwd)
      ensureChat(id, [])
      setSessionId(id)
    }
    const handleSelectSession = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      if (!id) return
      selectedSessionIdRef.current = id
      if (
        Object.hasOwn(messagesBySessionIdRef.current, id) &&
        Object.hasOwn(cwdBySessionIdRef.current, id)
      ) {
        setSessionId(id)
        return
      }
      void loadSession(id).then(() => {
        if (selectedSessionIdRef.current === id) setSessionId(id)
      })
    }

    window.addEventListener('agent:new-session', handleNewSession)
    window.addEventListener('agent:select-session', handleSelectSession)
    const handleSessionsChanged = (): void => void refreshSessions()
    window.addEventListener('agent:sessions-changed', handleSessionsChanged)
    queueMicrotask(() => {
      void loadSession(sessionId).then(refreshSessions)
    })
    return () => {
      window.removeEventListener('agent:new-session', handleNewSession)
      window.removeEventListener('agent:select-session', handleSelectSession)
      window.removeEventListener('agent:sessions-changed', handleSessionsChanged)
    }
  }, [])

  // The ref is an imperative Chat cache; ensureChat does not derive rendered UI from it.
  // eslint-disable-next-line react-hooks/refs
  const chat = ensureChat(sessionId, messagesBySessionId[sessionId] ?? [])
  const cwd = cwdBySessionId[sessionId] ?? ''

  return (
    <AssistantChat
      key={sessionId}
      chat={chat}
      cwd={cwd}
      defaultCwd={defaultCwd}
      onSetCwd={(value) => selectSessionCwd(sessionId, value)}
      recentCwds={recentCwds}
      onSaveSession={saveSessionMessages}
      sessions={sessions}
      modelConfig={modelConfig}
      onModelConfigChange={setModelConfig}
    />
  )
}

function AttachmentPreviewBar({
  onCountChange
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
    const paths = await window.bridge.invoke('dialog:pick-directories')
    if (!Array.isArray(paths)) return
    attachments.addParts(
      paths
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
        .map(createDirectoryAttachment)
    )
  }

  return (
    <PromptInputActionMenuItem
      className="gap-2"
      onSelect={(event) => {
        event.preventDefault()
        void pickDirectories()
      }}
    >
      <FolderIcon className="size-4" />
      目录
    </PromptInputActionMenuItem>
  )
}

function AssistantChat({
  chat,
  cwd,
  defaultCwd,
  onSetCwd,
  recentCwds,
  onSaveSession,
  sessions,
  modelConfig,
  onModelConfigChange
}: {
  chat: Chat<UIMessage>
  cwd: string
  defaultCwd: string
  onSetCwd: (cwd: string) => void
  recentCwds: string[]
  onSaveSession: (id: string, messages: UIMessage[], cwd: string) => void
  sessions: SessionMeta[]
  modelConfig: AgentModelConfig
  onModelConfigChange: (value: AgentModelConfig) => void
}): React.JSX.Element {
  const { messages, sendMessage, status, stop } = useChat({ chat, throttle: 50 })
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        event.ctrlKey &&
        event.altKey &&
        !event.shiftKey &&
        !event.metaKey &&
        event.code === 'KeyC'
      ) {
        event.preventDefault()
        void navigator.clipboard.writeText(conversationToText(messagesRef.current))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const inputFrameRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLDivElement>(null)
  const pendingInitialSaveRef = useRef(false)
  const submittingRef = useRef(false)
  const stoppingRef = useRef(false)
  const submittedMessageCountRef = useRef(0)
  const inputHistoryIndexRef = useRef<number | null>(null)
  const inputDraftRef = useRef('')
  const [menuMetrics, setMenuMetrics] = useState({
    alignOffset: -12,
    sideOffset: 0,
    width: 320
  })
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [workspaceHistoryOpen, setWorkspaceHistoryOpen] = useState(false)
  const [openSessionCwds, setOpenSessionCwds] = useState<Set<string>>(new Set())
  const [expandedSessionCwds, setExpandedSessionCwds] = useState<Set<string>>(new Set())
  const [inputText, setInputText] = useState('')
  const [attachmentCount, setAttachmentCount] = useState(0)
  const [runCancelled, setRunCancelled] = useState(false)
  const isLive = status === 'streaming' || status === 'submitted'
  const workspaceLocked = messages.length > 0 || isLive
  const canSubmit = inputText.trim().length > 0 || attachmentCount > 0 || isLive
  const inputHistory = messages
    .filter((message) => message.role === 'user')
    .map((message) =>
      message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    )
    .filter(Boolean)

  useEffect(() => {
    if (isLive) return
    submittingRef.current = false
    stoppingRef.current = false
  }, [isLive])

  useEffect(() => {
    if (!pendingInitialSaveRef.current) return
    if (messages.length <= submittedMessageCountRef.current) return
    pendingInitialSaveRef.current = false
    onSaveSession(chat.id, messages, cwd)
  }, [chat.id, cwd, messages, onSaveSession])

  const handleSubmit = (message: PromptInputMessage): void => {
    if (isLive || submittingRef.current) return
    const text = message.text.trim()
    const files = message.files
    if (text || files.length > 0) {
      setRunCancelled(false)
      submittingRef.current = true
      setInputText('')
      inputHistoryIndexRef.current = null
      inputDraftRef.current = ''
      pendingInitialSaveRef.current = true
      submittedMessageCountRef.current = messages.length
      void sendMessage({ text, files })
    }
  }

  const handleStop = (): void => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setRunCancelled(true)
    if (messages.length > 0) onSaveSession(chat.id, messages, cwd)
    void stop()
  }

  const selectSession = (id: string): void => {
    window.dispatchEvent(new CustomEvent('agent:select-session', { detail: id }))
  }

  const pickWorkspace = async (): Promise<void> => {
    const paths = await window.bridge.invoke('dialog:pick-directories')
    const path = Array.isArray(paths) ? paths[0] : undefined
    if (typeof path === 'string' && path) onSetCwd(path)
  }

  const otherWorkspaces = recentCwds.filter((path) => path !== cwd)
  const sessionGroups = Array.from(
    sessions.reduce((groups, session) => {
      const key = session.cwd || defaultCwd
      if (!key) return groups
      const group = groups.get(key)
      if (group) group.push(session)
      else groups.set(key, [session])
      return groups
    }, new Map<string, SessionMeta[]>())
  )

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
    ) {
      return
    }

    const textarea = event.currentTarget
    const moveCursorToEnd = (value: string): void => {
      requestAnimationFrame(() => textarea.setSelectionRange(value.length, value.length))
    }

    if (
      event.key === 'ArrowUp' &&
      !textarea.value.slice(0, textarea.selectionStart).includes('\n')
    ) {
      if (inputHistory.length === 0) return
      event.preventDefault()
      const currentIndex = inputHistoryIndexRef.current
      if (currentIndex === null) inputDraftRef.current = inputText
      const nextIndex =
        currentIndex === null ? inputHistory.length - 1 : Math.max(0, currentIndex - 1)
      const value = inputHistory[nextIndex]
      inputHistoryIndexRef.current = nextIndex
      setInputText(value)
      moveCursorToEnd(value)
      return
    }

    if (
      event.key === 'ArrowDown' &&
      inputHistoryIndexRef.current !== null &&
      !textarea.value.slice(textarea.selectionEnd).includes('\n')
    ) {
      event.preventDefault()
      const nextIndex = inputHistoryIndexRef.current + 1
      if (nextIndex < inputHistory.length) {
        const value = inputHistory[nextIndex]
        inputHistoryIndexRef.current = nextIndex
        setInputText(value)
        moveCursorToEnd(value)
      } else {
        const value = inputDraftRef.current
        inputHistoryIndexRef.current = null
        setInputText(value)
        moveCursorToEnd(value)
      }
    }
  }

  useLayoutEffect(() => {
    const measure = (): void => {
      const frame = inputFrameRef.current?.getBoundingClientRect()
      const trigger = menuTriggerRef.current?.getBoundingClientRect()
      if (!frame || !trigger) return
      const next = {
        alignOffset: Math.round(frame.left - trigger.left),
        sideOffset: Math.max(0, Math.round(trigger.top - frame.top)),
        width: Math.round(frame.width)
      }
      setMenuMetrics((current) =>
        current.alignOffset === next.alignOffset &&
        current.sideOffset === next.sideOffset &&
        current.width === next.width
          ? current
          : next
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    if (inputFrameRef.current) observer.observe(inputFrameRef.current)
    return () => observer.disconnect()
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
              onChange={(event) => {
                inputHistoryIndexRef.current = null
                setInputText(event.target.value)
              }}
              onKeyDown={handleInputKeyDown}
              className="max-h-48 min-h-12 overflow-y-auto pl-3"
            />
          </PromptInputBody>
          <PromptInputFooter className="justify-between">
            <PromptInputTools className="flex-1 overflow-hidden">
              <PromptInputActionMenu
                open={actionMenuOpen}
                onOpenChange={(open) => {
                  setActionMenuOpen(open)
                  if (!open) setWorkspaceHistoryOpen(false)
                }}
              >
                <div ref={menuTriggerRef}>
                  <PromptInputActionMenuTrigger
                    size="icon-sm"
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
                    {labels.workspace}
                  </div>
                  {!workspaceLocked && workspaceHistoryOpen ? (
                    <>
                      {otherWorkspaces.map((path) => (
                        <PromptInputActionMenuItem
                          key={path}
                          className="gap-2"
                          title={path}
                          onSelect={(event) => {
                            event.preventDefault()
                            setWorkspaceHistoryOpen(false)
                            onSetCwd(path)
                          }}
                        >
                          <FolderIcon className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{path}</span>
                        </PromptInputActionMenuItem>
                      ))}
                      <PromptInputActionMenuItem
                        className="gap-2"
                        onSelect={(event) => {
                          event.preventDefault()
                          setWorkspaceHistoryOpen(false)
                          void pickWorkspace()
                        }}
                      >
                        <FolderOpenIcon className="size-4 shrink-0" />
                        <span>选择其他目录</span>
                      </PromptInputActionMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <PromptInputActionMenuItem
                    className="gap-2"
                    disabled={workspaceLocked}
                    onSelect={(event) => {
                      event.preventDefault()
                      if (otherWorkspaces.length === 0) {
                        void pickWorkspace()
                        return
                      }
                      setWorkspaceHistoryOpen((open) => !open)
                    }}
                  >
                    {workspaceLocked ? (
                      <FolderIcon className="size-4 shrink-0" />
                    ) : (
                      <FolderPlusIcon className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{cwd}</span>
                    {!workspaceLocked && otherWorkspaces.length > 0 ? (
                      workspaceHistoryOpen ? (
                        <ChevronUpIcon className="size-4 shrink-0" />
                      ) : (
                        <ChevronDownIcon className="size-4 shrink-0" />
                      )
                    ) : null}
                  </PromptInputActionMenuItem>
                  <DropdownMenuSeparator />
                  <div className="flex min-h-7 items-center justify-between gap-4 px-2 py-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      <span>思考模式</span>
                    </div>
                    <div className="flex translate-x-1 rounded-full bg-muted p-0.5 text-xs">
                      {(
                        [
                          ['disabled', '快速'],
                          ['enabled', '深度']
                        ] as const
                      ).map(([thinking, label]) => (
                        <button
                          key={thinking}
                          type="button"
                          className={`rounded-full px-3 py-0.5 transition-colors ${
                            modelConfig.thinking === thinking
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          disabled={isLive}
                          onClick={() => onModelConfigChange({ ...modelConfig, thinking })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {modelIds.map((modelId) => (
                    <PromptInputActionMenuItem
                      key={modelId}
                      className="gap-2"
                      disabled={isLive}
                      onSelect={(event) => {
                        event.preventDefault()
                        onModelConfigChange({ ...modelConfig, modelId })
                      }}
                    >
                      <span className="flex-1">{modelLabels[modelId]}</span>
                      {modelId === modelConfig.modelId ? (
                        <span className="flex w-4 shrink-0 translate-x-1 justify-end">
                          <CheckIcon className="size-4" />
                        </span>
                      ) : null}
                    </PromptInputActionMenuItem>
                  ))}
                  <DropdownMenuSeparator />
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
                      sessionGroups.map(([groupCwd, groupSessions]) => (
                        <div key={groupCwd}>
                          <PromptInputActionMenuItem
                            className="gap-2 text-muted-foreground"
                            title={groupCwd}
                            onSelect={(event) => {
                              event.preventDefault()
                              const next = toggleSessionGroup(
                                openSessionCwds,
                                expandedSessionCwds,
                                groupCwd
                              )
                              setOpenSessionCwds(next.open)
                              setExpandedSessionCwds(next.expanded)
                            }}
                          >
                            <FolderClockIcon className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              {getPathFilename(groupCwd)}
                            </span>
                            {openSessionCwds.has(groupCwd) ? (
                              <ChevronUpIcon className="size-4 shrink-0" />
                            ) : (
                              <ChevronDownIcon className="size-4 shrink-0" />
                            )}
                          </PromptInputActionMenuItem>
                          {openSessionCwds.has(groupCwd)
                            ? groupSessions
                                .slice(
                                  0,
                                  expandedSessionCwds.has(groupCwd)
                                    ? groupSessions.length
                                    : MAX_SESSIONS_PER_CWD
                                )
                                .map((session) => (
                                  <PromptInputActionMenuItem
                                    key={session.id}
                                    onSelect={() => selectSession(session.id)}
                                    className={`gap-2 pl-8 ${
                                      session.id === chat.id
                                        ? 'bg-accent text-accent-foreground'
                                        : ''
                                    }`}
                                    aria-current={session.id === chat.id ? 'page' : undefined}
                                  >
                                    <span className="min-w-0 flex-1 truncate">
                                      {session.title || labels.unnamedTask}
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {formatRelativeTime(session.updatedAt)}
                                    </span>
                                  </PromptInputActionMenuItem>
                                ))
                            : null}
                          {openSessionCwds.has(groupCwd) &&
                          groupSessions.length > MAX_SESSIONS_PER_CWD ? (
                            <PromptInputActionMenuItem
                              className="pl-8 text-xs text-muted-foreground"
                              onSelect={(event) => {
                                event.preventDefault()
                                setExpandedSessionCwds((current) => {
                                  const next = new Set(current)
                                  if (next.has(groupCwd)) next.delete(groupCwd)
                                  else next.add(groupCwd)
                                  return next
                                })
                              }}
                            >
                              {expandedSessionCwds.has(groupCwd) ? '收起' : '展开'}
                            </PromptInputActionMenuItem>
                          ) : null}
                        </div>
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
              className="rounded-full disabled:bg-primary disabled:text-primary-foreground"
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
      <Virtuoso<UIMessage>
        className="min-w-0 flex-1"
        data={messages}
        initialTopMostItemIndex={Math.max(messages.length - 1, 0)}
        followOutput={isLive ? 'smooth' : false}
        computeItemKey={(_, message) => message.id}
        itemContent={(index, message) => (
          <div className="mx-auto w-full max-w-3xl px-6">
            <MemoizedMessageView
              message={message}
              streaming={isLive && index === messages.length - 1}
            />
          </div>
        )}
        components={{
          Footer: () => (
            <div className="mx-auto w-full max-w-3xl px-6">
              <RunActivity active={isLive} cancelled={runCancelled} failed={status === 'error'} />
            </div>
          )
        }}
      />
      {input}
    </div>
  )
}
