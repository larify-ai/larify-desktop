import type { Disposable } from '../../infra/disposable'
import type { SessionStore } from '../session'
import { AgentWorker, type AgentInput, type AgentSink } from './worker'

export type { AgentInput, AgentSink } from './worker'

export class Agent implements Disposable {
  private readonly workers = new Map<string, AgentWorker>()

  constructor(private readonly sessions: SessionStore) {}

  send(input: AgentInput, sink: AgentSink): void {
    if (this.workers.has(input.sessionId)) throw new Error('Agent is already running.')
    const worker = new AgentWorker(this.sessions, sink)
    this.workers.set(input.sessionId, worker)
    void worker.run(input).finally(() => {
      if (this.workers.get(input.sessionId) === worker) this.workers.delete(input.sessionId)
    })
  }

  cancel(sessionId: string): void {
    const worker = this.workers.get(sessionId)
    if (!worker) return
    this.workers.delete(sessionId)
    worker.cancel()
  }

  dispose(): void {
    for (const worker of this.workers.values()) worker.cancel()
    this.workers.clear()
  }
}
