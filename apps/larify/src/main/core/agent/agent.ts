import type { UIMessage } from 'ai'
import type { Disposable } from '@shared/infra/disposable'
import { larifyWorkspacePath } from '../../utils/app-paths'
import type { AgentModelConfig } from '../model/config'
import type { PluginHost } from '../plugin/host'
import type { SessionStore } from '../session'
import { createAgentRuntime } from './runtime'
import { AgentWorker, type AgentSink } from './worker'
import { GitSnapshotService } from '../git/snapshot'

export type { AgentSink } from './worker'

export interface AgentInput {
  sessionId: string
  cwd?: string
  message: UIMessage
  modelConfig?: AgentModelConfig
}

export class Agent implements Disposable {
  private readonly workers = new Map<string, AgentWorker>()
  private readonly snapshots = new GitSnapshotService()

  constructor(
    private readonly sessions: SessionStore,
    private readonly pluginHost: PluginHost
  ) {}

  send(input: AgentInput, sink: AgentSink): void {
    if (this.workers.has(input.sessionId)) throw new Error('Agent is already running.')
    const request = { ...input, cwd: input.cwd || larifyWorkspacePath() }
    const runtime = createAgentRuntime(request, this.pluginHost)
    const worker = new AgentWorker(this.sessions, this.snapshots, sink)
    this.workers.set(input.sessionId, worker)
    void worker.run({ ...request, runtime }).finally(() => {
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
