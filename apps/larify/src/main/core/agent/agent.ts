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

  async send(input: AgentInput, sink: AgentSink): Promise<void> {
    if (this.workers.has(input.sessionId)) throw new Error('Agent is already running.')
    const request = { ...input, cwd: input.cwd || larifyWorkspacePath() }
    const track = this.acquireTrack(input.sessionId, request.cwd, input.message)
    this.activeSinks.set(input.sessionId, sink)
    const worker = new AgentWorker(this.sessions, sink, this.pluginHost, track)
    // 先注册 worker（避免 await 期间同会话重复发送的竞态），再刷新磁盘插件。
    this.workers.set(input.sessionId, worker)
    try {
      // 刷新插件（含新增/修改/删除的 MCP server）会连接 MCP 并触发 OAuth 授权。
      // 这里 **await**（而非 fire-and-forget）：本次消息必须先等插件加载/OAuth 认证完成，
      // 才能在带认证结果的工具集上运行——否则第一条消息会用未认证的旧工具集，
      // 新插件要等第二条消息才生效（用户反馈的"要发第二条才有"）。
      await this.pluginHost.refreshPlugins(pluginDiscovery.discover())
      const runtime = createAgentRuntime(request, this.pluginHost)
      void worker.run({ ...request, runtime }).finally(() => {
        if (this.workers.get(input.sessionId) === worker) this.workers.delete(input.sessionId)
        if (this.activeSinks.get(input.sessionId) === sink) this.activeSinks.delete(input.sessionId)
      })
    } catch (error) {
      // 刷新或 runtime 装配失败：清理已注册的 worker/sink，避免会话被误判为"运行中"。
      if (this.workers.get(input.sessionId) === worker) this.workers.delete(input.sessionId)
      if (this.activeSinks.get(input.sessionId) === sink) this.activeSinks.delete(input.sessionId)
      throw error
    }
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
