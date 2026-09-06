import type { UIMessage, UIMessageChunk } from 'ai'
import { randomUUID } from 'node:crypto'
import { clearReadState } from '../../../extensions/fs/main/state'
import type { SessionStore } from '../session'
import type { AgentModelConfig } from '../model/config'
import type { AgentOptions } from './engine'
import { runStoredAgentSession } from './persist'
import { AgentReview, FileChangeTracker, reviewChunk } from './review'
import type { PluginHost } from '../plugin/host'
import { pluginDiscovery } from '../plugin/plugin-discovery'

const reviewTools = new Set(['fs_edit', 'fs_write'])
const resetContextTool = 'agent_reset_context'

export interface AgentWorkerInput {
  sessionId: string
  cwd: string
  message: UIMessage
  runtime: AgentOptions
  /** 复用本次会话模型配置（携带 apiKey 时标题生成同样直连官方）。 */
  modelConfig?: AgentModelConfig
}

export interface SessionTrack {
  cwd: string
  review: AgentReview
  tracker: FileChangeTracker
}

export interface AgentSink {
  chunk(chunk: UIMessageChunk): void
  title?(title: string): void
  error(error: unknown): void
  end(): void
}

export class AgentWorker {
  private controller?: AbortController
  private closed = false

  constructor(
    private readonly sessions: SessionStore,
    private readonly sink: AgentSink,
    private readonly pluginHost: PluginHost,
    private readonly track?: SessionTrack
  ) {}

  async run(input: AgentWorkerInput): Promise<void> {
    if (this.controller || this.closed) return
    const controller = new AbortController()
    this.controller = controller
    try {
      // ask_user 回答/reset_context 都是同一任务的续写：追踪器由 Agent 按会话持有，
      // 跨 worker 复用（track?.review/track?.tracker），不会因为新 worker 而丢文件。
      const activeReview =
        this.track?.review ??
        new AgentReview(input.cwd, (chunk) => {
          if (!controller.signal.aborted) this.sink.chunk(chunk)
        })
      const fileChanges = this.track?.tracker ?? new FileChangeTracker()
      // 每轮结束时把当前任务快照写回持久化：
      // runStoredAgentSession 的 onMessage 只保存流内消息（不含 review part），
      // 会覆盖掉上一轮已持久化的快照；这里把最新快照（同 id 原地替换）写回，
      // 保证"ask_user 前改的文件"在重载/切换会话后仍然可见。
      const saveReview = (response: UIMessage): void => {
        // Reconcile once more before persisting so a file deleted after the
        // last tool output still surfaces as a deletion in the final card.
        for (const tracked of fileChanges.syncResults()) {
          activeReview.update(tracked)
        }
        const snapshot = activeReview.finish()
        if (!snapshot) return
        const chunk = reviewChunk(snapshot)
        const existingIndex = response.parts.findIndex(
          (part) => part.type === 'data-git-snapshot' && part.id === 'review'
        )
        if (existingIndex >= 0) {
          response.parts[existingIndex] = chunk as (typeof response.parts)[number]
        } else {
          response.parts.push(chunk as (typeof response.parts)[number])
        }
        this.sessions.saveMessages(input.sessionId, [response])
      }
      let handoff: string | undefined
      const toolsContext = Object.fromEntries(
        Object.entries(input.runtime.toolsContext).map(([name, context]) => [
          name,
          reviewTools.has(name)
            ? {
                ...(context as Record<string, unknown>),
                trackFileChange: fileChanges.update.bind(fileChanges)
              }
            : context
        ])
      )
      const resetContext = toolsContext[resetContextTool]
      if (resetContext) {
        toolsContext[resetContextTool] = {
          ...(resetContext as Record<string, unknown>),
          requestContextReset: (value: string) => {
            handoff = value
          }
        }
      }
      const reviewToolCalls = new Set<string>()
      const originalStopWhen = input.runtime.stopWhen
      const runOnce = (message: UIMessage): Promise<UIMessage | undefined> =>
        runStoredAgentSession(this.sessions, {
          sessionId: input.sessionId,
          cwd: input.cwd,
          message,
          modelConfig: input.modelConfig,
          options: {
            ...input.runtime,
            toolsContext,
            abortSignal: controller.signal,
            stopWhen: async (options) =>
              handoff !== undefined || (originalStopWhen ? await originalStopWhen(options) : false)
          },
          onTitle: (title) => {
            if (!controller.signal.aborted) this.sink.title?.(title)
          },
          onChunk: (chunk) => {
            if (controller.signal.aborted) return
            this.sink.chunk(chunk)
            if (
              (chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') &&
              reviewTools.has(chunk.toolName)
            ) {
              reviewToolCalls.add(chunk.toolCallId)
            } else if (
              chunk.type === 'tool-output-available' &&
              !chunk.preliminary &&
              reviewToolCalls.delete(chunk.toolCallId)
            ) {
              const output = chunk.output
              if (
                output &&
                typeof output === 'object' &&
                typeof (output as { path?: unknown }).path === 'string'
              ) {
                // Sync every tracked file (including ones deleted outside the
                // tracked tools, e.g. via the terminal) into the review card.
                for (const tracked of fileChanges.syncResults()) {
                  activeReview.update(tracked)
                }
              }
            } else if (
              chunk.type === 'tool-input-error' ||
              chunk.type === 'tool-output-error' ||
              chunk.type === 'tool-output-denied'
            ) {
              reviewToolCalls.delete(chunk.toolCallId)
            }
          }
        })
      let response = await runOnce(input.message)
      if (response) saveReview(response)
      while (handoff) {
        if (controller.signal.aborted) return
        const message: UIMessage = {
          id: randomUUID(),
          role: 'user',
          metadata: { compaction: true },
          parts: [...input.message.parts, { type: 'text', text: `# Handoff\n\n${handoff}` }]
        }
        handoff = undefined
        // reset_context 走进程内 handoff，不经过 Agent.send()，故此处显式刷新
        // 磁盘插件（增量 diff），让"重置上下文"后的续写立即可见新增/修改/删除的
        // MCP server。await：reset 本就是重置语义，阻塞等刷新完再续写。
        await this.pluginHost.refreshPlugins(pluginDiscovery.discover())
        clearReadState(input.sessionId)
        this.sessions.saveStart(input.sessionId, message)
        response = await runOnce(message)
        if (response) saveReview(response)
      }
      if (!controller.signal.aborted) this.finish(() => this.sink.end())
    } catch (error) {
      // abort 是用户主动停止（cancel()），预期路径，不按错误留痕。
      // 主进程留痕：agent 运行级错误（非流内部，如工具执行/持久化失败）。
      if (!controller.signal.aborted) {
        console.error('[agent] run failed:', error)
        this.finish(() => this.sink.error(error))
      }
    } finally {
      if (this.controller === controller) this.controller = undefined
    }
  }

  cancel(): void {
    if (this.closed) return
    // 尚未 run()（例如在 send() 等待插件/OAuth 刷新期间被取消）：标记关闭，
    // 让 run() 直接跳过，避免刷新完成后继续执行本次消息。
    if (!this.controller) {
      this.closed = true
      return
    }
    this.controller.abort()
    this.finish(() => this.sink.end())
  }

  private finish(notify: () => void): void {
    if (this.closed) return
    this.closed = true
    notify()
  }
}
