import type { UIMessage, UIMessageChunk } from 'ai'
import type { SessionStore } from '../session'
import type { AgentOptions } from './engine'
import { runStoredAgentSession } from './persist'

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
    private readonly sink: AgentSink
  ) {}

  async run(input: AgentWorkerInput): Promise<void> {
    if (this.controller || this.closed) return
    const controller = new AbortController()
    this.controller = controller
    try {
      await runStoredAgentSession(this.sessions, {
        sessionId: input.sessionId,
        cwd: input.cwd,
        message: input.message,
        options: { ...input.runtime, abortSignal: controller.signal },
        onChunk: (chunk) => {
          if (!controller.signal.aborted) this.sink.chunk(chunk)
        }
      })
      if (!controller.signal.aborted) this.finish(() => this.sink.end())
    } catch (error) {
      if (!controller.signal.aborted) this.finish(() => this.sink.error(error))
    } finally {
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
