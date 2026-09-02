import type { UIMessage } from 'ai'
import type { Disposable } from '@shared/infra/disposable'
import { larifyWorkspacePath } from '../../utils/app-paths'
import type { AgentModelConfig } from '../model/config'
import type { PluginHost } from '../plugin/host'
import { pluginDiscovery } from '../plugin/plugin-discovery'
import type { SessionStore } from '../session'
import { createAgentRuntime } from './runtime'
import { AgentReview, FileChangeTracker } from './review'
import { AgentWorker, type AgentSink, type SessionTrack } from './worker'

export type { AgentSink } from './worker'

export interface AgentInput {
  sessionId: string
  cwd?: string
  message: UIMessage
  modelConfig?: AgentModelConfig
}

export class Agent implements Disposable {
  private readonly workers = new Map<string, AgentWorker>()
  // 变更追踪按会话持有：ask_user 回答/reset_context 都是同一任务的续写
  // （UI 发送的最后一条消息是 assistant 续写），必须复用同一个追踪器，
  // 否则新一轮 worker 的空白追踪器会把已有变更"清零"。仅当发起新用户
  // 请求（最后一条是 user 消息）或切换工作目录时才重置。
  private readonly tracks = new Map<string, SessionTrack>()
  private readonly activeSinks = new Map<string, AgentSink>()

  constructor(
    private readonly sessions: SessionStore,
    private readonly pluginHost: PluginHost
  ) {}

  send(input: AgentInput, sink: AgentSink): void {
    if (this.workers.has(input.sessionId)) throw new Error('Agent is already running.')
    // 增量刷新磁盘插件（含新增/修改/删除的 MCP server）。fire-and-forget：
    // 本次请求仍用当前工具集，下一次请求即生效。
    void this.pluginHost.refreshPlugins(pluginDiscovery.discover())
    const request = { ...input, cwd: input.cwd || larifyWorkspacePath() }
    const runtime = createAgentRuntime(request, this.pluginHost)
    const track = this.acquireTrack(input.sessionId, request.cwd, input.message)
    this.activeSinks.set(input.sessionId, sink)
    const worker = new AgentWorker(this.sessions, sink, this.pluginHost, track)
    this.workers.set(input.sessionId, worker)
    void worker.run({ ...request, runtime }).finally(() => {
      if (this.workers.get(input.sessionId) === worker) this.workers.delete(input.sessionId)
      if (this.activeSinks.get(input.sessionId) === sink) this.activeSinks.delete(input.sessionId)
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
    for (const track of this.tracks.values()) track.review.dispose()
    this.tracks.clear()
    this.activeSinks.clear()
  }

  private acquireTrack(sessionId: string, cwd: string, message: UIMessage): SessionTrack {
    const continuing = message.role === 'assistant'
    const existing = this.tracks.get(sessionId)
    if (existing && continuing && existing.cwd === cwd) return existing
    existing?.review.dispose()
    const track: SessionTrack = {
      cwd,
      review: new AgentReview(cwd, (chunk) => {
        if (!this.activeSinks.has(sessionId)) return
        // 精确匹配当前 sink，防止旧流关闭后仍向旧通道写入。
        this.activeSinks.get(sessionId)?.chunk(chunk)
      }),
      tracker: new FileChangeTracker()
    }
    this.tracks.set(sessionId, track)
    return track
  }
}
