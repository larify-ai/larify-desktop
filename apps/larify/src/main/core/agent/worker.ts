import type { UIMessage, UIMessageChunk } from 'ai'
import type { SessionStore } from '../session'
import type { AgentOptions } from './engine'
import { runStoredAgentSession } from './persist'
import { GitSnapshotService } from '../git/snapshot'
import { AgentReview, reviewChunk } from './review'

const reviewTools = new Set(['fs_edit', 'fs_write'])

export interface AgentWorkerInput {
  sessionId: string
  cwd: string
  message: UIMessage
  runtime: AgentOptions
}

export interface AgentSink {
  chunk(chunk: UIMessageChunk): void
  error(error: unknown): void
  end(): void
}

export class AgentWorker {
  private controller?: AbortController
  private closed = false

  constructor(
    private readonly sessions: SessionStore,
    private readonly snapshots: GitSnapshotService,
    private readonly sink: AgentSink
  ) {}

  async run(input: AgentWorkerInput): Promise<void> {
    if (this.controller || this.closed) return
    const controller = new AbortController()
    this.controller = controller
    let review: AgentReview | undefined
    try {
      const start = await this.snapshots.start(input.cwd)
      if (controller.signal.aborted) return
      const activeReview = new AgentReview(this.snapshots, start, (chunk) => {
        if (!controller.signal.aborted) this.sink.chunk(chunk)
      })
      review = activeReview
      const reviewToolCalls = new Set<string>()
      const response = await runStoredAgentSession(this.sessions, {
        sessionId: input.sessionId,
        cwd: input.cwd,
        message: input.message,
        options: { ...input.runtime, abortSignal: controller.signal },
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
            activeReview.update()
          } else if (
            chunk.type === 'tool-input-error' ||
            chunk.type === 'tool-output-error' ||
            chunk.type === 'tool-output-denied'
          ) {
            reviewToolCalls.delete(chunk.toolCallId)
          }
        }
      })
      if (controller.signal.aborted) return
      const snapshot = await activeReview.finish()
      if (snapshot && response) {
        response.parts.push(reviewChunk(snapshot) as (typeof response.parts)[number])
        this.sessions.saveMessages(input.sessionId, [response])
      }
      if (!controller.signal.aborted) this.finish(() => this.sink.end())
    } catch (error) {
      if (!controller.signal.aborted) this.finish(() => this.sink.error(error))
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
