import type { UIMessage, UIMessageChunk } from 'ai'
import { randomUUID } from 'node:crypto'
import { clearReadState } from '../../../extensions/fs/main/state'
import type { SessionStore } from '../session'
import type { AgentOptions } from './engine'
import { runStoredAgentSession } from './persist'
import { AgentReview, FileChangeTracker, reviewChunk } from './review'

const reviewTools = new Set(['fs_edit', 'fs_write'])
const resetContextTool = 'agent_reset_context'

export interface AgentWorkerInput {
  sessionId: string
  cwd: string
  message: UIMessage
  runtime: AgentOptions
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
    private readonly sink: AgentSink
  ) {}

  async run(input: AgentWorkerInput): Promise<void> {
    if (this.controller || this.closed) return
    const controller = new AbortController()
    this.controller = controller
    let review: AgentReview | undefined
    try {
      const activeReview = new AgentReview(input.cwd, (chunk) => {
        if (!controller.signal.aborted) this.sink.chunk(chunk)
      })
      const fileChanges = new FileChangeTracker()
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
      review = activeReview
      const reviewToolCalls = new Set<string>()
      const originalStopWhen = input.runtime.stopWhen
      const runOnce = (message: UIMessage): Promise<UIMessage | undefined> =>
        runStoredAgentSession(this.sessions, {
          sessionId: input.sessionId,
          cwd: input.cwd,
          message,
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
              const tracked =
                output &&
                typeof output === 'object' &&
                typeof (output as { path?: unknown }).path === 'string'
                  ? fileChanges.result((output as { path: string }).path)
                  : undefined
              if (tracked) activeReview.update(tracked)
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
      while (handoff) {
        if (controller.signal.aborted) return
        const message: UIMessage = {
          id: randomUUID(),
          role: 'user',
          metadata: { compaction: true },
          parts: [...input.message.parts, { type: 'text', text: `# Handoff\n\n${handoff}` }]
        }
        handoff = undefined
        clearReadState(input.sessionId)
        this.sessions.saveStart(input.sessionId, message)
        response = await runOnce(message)
      }
      if (controller.signal.aborted) return
      const snapshot = activeReview.finish()
      if (snapshot && response) {
        response.parts.push(reviewChunk(snapshot) as (typeof response.parts)[number])
        this.sessions.saveMessages(input.sessionId, [response])
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
      review?.dispose()
      if (this.controller === controller) this.controller = undefined
    }
  }

  cancel(): void {
    if (!this.controller) return
    this.controller.abort()
    this.finish(() => this.sink.end())
  }

  private finish(notify: () => void): void {
    if (this.closed) return
    this.closed = true
    notify()
  }
}
