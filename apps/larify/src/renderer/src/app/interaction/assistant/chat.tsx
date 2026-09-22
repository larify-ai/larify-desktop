import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat, type Chat } from '@ai-sdk/react'
import type { UIMessage } from 'ai'
import { AssistantMessageList } from './message-list'
import { AssistantComposer } from './composer'
import type { ConversationHeading } from './conversation-header'
import { ToolOutputContext } from './tool-output'
import { sessionAttentionState, useSessionAttentionReport } from './session-attention'
import type { SessionNavigationItem } from './session-messages'

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
  navigationItems,
  onLoadOlderNavigation,
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
  navigationItems: SessionNavigationItem[]
  onLoadOlderNavigation: () => void
  onLoadRange: (firstPage: number, lastPage: number) => void
  onCwdChange: (cwd: string) => void
  onHeadingChange: (heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const { addToolOutput, clearError, error, messages, sendMessage, setMessages, status, stop } =
    useChat({
      chat,
      // 50ms → 100ms：@ai-sdk/react 每次 throttle tick 都会浅拷贝活跃消息全部 parts
      // （snapshot 快照），巨型流式消息（数百 parts）每 tick 的拷贝量就是 GC/长任务
      // 的来源（实测：0.57s 一个 50-150ms 长任务 = major GC，99.8% Profiler 样本）。
      // 100ms 合并后分配频率减半，GC 长任务约减半；chunk 仍 20ms 到达，仅 UI 更新
      // 20fps→10fps，流式观感几乎无差。
      throttle: 100
    })
  const attentionState = sessionAttentionState(status, messages)
  // 停在 ask_user 等待回答时，与「正在 streaming」完全等价：底部 Composer 的发送按钮不可点、
  // 也不能从底部开新轮（新消息会被主进程当成新任务，旧问题卡悬挂成"同时等两个回答"）。
  // 直接借用 attentionState 判定，无需给 Composer 增加任何新参数。
  const running = status === 'submitted' || status === 'streaming' || attentionState === 'waiting'
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
        const message = current[index]
        const metadata = (message.metadata ?? {}) as Record<string, unknown>
        // 已标记为中断则幂等返回。
        if (metadata.outcome === 'aborted') return current
        const currentRunStartedAt = runStartedAt.current
        // 无本次 run 起点（例如尚未提交，或测试/外部直接触发 stop）时，不覆盖已有终态，
        // 避免 stop 与"上一轮已完成"竞态时把历史响应误标为中断。有本次 run 起点时，
        // 只要该响应属于本次 run（在最后一条 user 之后），取消就应把它标为 aborted，
        // 即使它已正常完成——用户取消了整个任务，多轮中已完成的中间轮不应显示"已完成"。
        if (currentRunStartedAt === undefined && typeof metadata.completedAt === 'number') {
          return current
        }
        const next = [...current]
        // 取消不等于"只剩本次这段时间"：这条消息此前可能已累积了 totalProcessingMs
        // （多轮/嵌套轮会逐轮累加）。若此处只改写 startedAt/completedAt，摘要会退化成
        // 「取消时刻 − 本次 run 起点」，把先前累计的时长**冲掉**——正是"运行很久、一取消时间就变少"。
        // 故：保留原有 startedAt，并把 totalProcessingMs 累加为「既有累计 + 本次 run 增量」。
        const priorTotal =
          typeof metadata.totalProcessingMs === 'number' &&
          Number.isFinite(metadata.totalProcessingMs)
            ? metadata.totalProcessingMs
            : undefined
        const runStart =
          currentRunStartedAt ??
          (typeof metadata.startedAt === 'number' ? metadata.startedAt : completedAt)
        const totalProcessingMs =
          priorTotal !== undefined ? priorTotal + Math.max(0, completedAt - runStart) : undefined
        next[index] = {
          ...message,
          metadata: {
            ...metadata,
            startedAt:
              typeof metadata.startedAt === 'number' &&
              (currentRunStartedAt === undefined || metadata.startedAt >= currentRunStartedAt)
                ? metadata.startedAt
                : runStart,
            completedAt,
            ...(totalProcessingMs !== undefined ? { totalProcessingMs } : {}),
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
      {error ? (
        <div data-agent-error className="mx-auto w-full max-w-4xl px-6 pt-3" role="alert">
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Agent 运行出错：{error.message}
          </div>
        </div>
      ) : null}
      <ToolOutputContext.Provider value={submitToolOutput}>
        <AssistantMessageList
          active={active}
          messages={messages}
          live={running}
          followRequest={followRequest}
          recentStart={recentStart}
          olderMessages={olderMessages}
          navigationItems={navigationItems}
          onLoadOlderNavigation={onLoadOlderNavigation}
          onLoadRange={onLoadRange}
        />
      </ToolOutputContext.Provider>
      <AssistantComposer
        cwd={cwd}
        history={history}
        status={status}
        showWorkspace={!started}
        onCwdChange={onCwdChange}
        onSubmit={({ text, files, workflowPrefix }) => {
          runStartedAt.current = Date.now()
          if (error) clearError()
          // 用户发送新消息后应强制滚到底部并开启流式跟随（与 submitToolOutput 一致）。
          // 否则若发送前用户曾上翻阅读（scrollMode='reading'），live 触发时
          // `scrollMode==='following'` 不成立、followOutput 返回 false，视图不会滚底，
          // 表现为"发送了消息却没自动滚到底部"。
          setFollowRequest((current) => current + 1)
          // 计划模式：仅当开关开启时给该轮用户消息打 `workflowPrefix` 标记，
          // 主进程据此在送模型时拼 `/follow_workflow` 前缀（关闭则完全不加）。
          void sendMessage({
            text,
            files,
            metadata: workflowPrefix ? { workflowPrefix: true } : undefined
          })
        }}
        onStop={() => void stopAndMarkAborted()}
      />
    </div>
  )
}
