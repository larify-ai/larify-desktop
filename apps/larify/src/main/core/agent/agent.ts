import type { UIMessage } from 'ai'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { Disposable } from '@shared/infra/disposable'
import { larifyPath, larifyWorkspacePath } from '../../utils/app-paths'
import type { AgentModelConfig } from '../model/config'
import type { PluginHost } from '../plugin/host'
import { pluginDiscovery } from '../plugin/plugin-discovery'
import type { SessionStore } from '../session'
import { clearReadState } from '../../../extensions/fs/main/state'
import { buildNestPrompt } from '../nest/prompt'
import type { AgentOptions } from './engine'
import { createAgentRuntime } from './runtime'
import { AgentReview, FileChangeTracker } from './review'
import { AgentWorker, type AgentSink, type SessionTrack } from './worker'

export type { AgentSink } from './worker'

/**
 * 顶层任务：task.md 直接位于任务根目录下（`<taskDirectory>/<name>/task.md`）。
 * 首次进入顶层任务、以及子任务完成后「回父」重新调度顶层任务，都走主链上下文（nested=false）；
 * 更深的子任务走独立上下文（nested=true）。这是区分「下探子任务」与「回到主任务」的依据，
 * 否则「回父」会被误当作又一层子任务而下探、永不终止。
 */
function isTopLevelTaskFile(taskFile: string): boolean {
  // 模型给出的 taskPath 可能用正斜杠，larifyPath 用平台分隔符（Windows 为反斜杠）；
  // 统一分隔符并忽略大小写后再比较，避免顶层任务被误判为子任务而下探不止。
  const normalize = (value: string): string => value.replaceAll('\\', '/').toLowerCase()
  return normalize(dirname(dirname(taskFile))) === normalize(larifyPath('tasks'))
}

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
  // 跨轮中止信号：cancel() 后编排层据此停止启动已排队的子任务。
  // 不能用「worker 注册是否还在」代替——循环会在每轮结束时重新注册 worker。
  private readonly cancellations = new Map<string, AbortController>()

  constructor(
    private readonly sessions: SessionStore,
    private readonly pluginHost: PluginHost
  ) {}

  async send(input: AgentInput, sink: AgentSink): Promise<void> {
    if (this.workers.has(input.sessionId)) throw new Error('Agent is already running.')
    const request = { ...input, cwd: input.cwd || larifyWorkspacePath() }
    const track = this.acquireTrack(input.sessionId, request.cwd, input.message)
    this.activeSinks.set(input.sessionId, sink)
    const cancellation = new AbortController()
    this.cancellations.set(input.sessionId, cancellation)
    // 多轮共享同一 sink，但每轮跑完（未再调度）都会各自 end——必须是同一个流只终结一次。
    let terminated = false
    const streamSink: AgentSink = {
      chunk: (chunk) => sink.chunk(chunk),
      title: (title) => sink.title?.(title),
      error: (error) => {
        if (terminated) return
        terminated = true
        sink.error(error)
      },
      end: () => {
        if (terminated) return
        terminated = true
        sink.end()
      }
    }
    // 先注册 worker（避免 await 期间同会话重复发送的竞态），再刷新磁盘插件。
    const worker = new AgentWorker(this.sessions, streamSink, this.pluginHost, track)
    this.workers.set(input.sessionId, worker)
    let runtime: AgentOptions
    try {
      // 刷新插件（含新增/修改/删除的 MCP server）会连接 MCP 并触发 OAuth 授权。
      // 这里 **await**（而非 fire-and-forget）：本次消息必须先等插件加载/OAuth 认证完成，
      // 才能在带认证结果的工具集上运行——否则第一条消息会用未认证的旧工具集，
      // 新插件要等第二条消息才生效（用户反馈的"要发第二条才有"）。
      await this.pluginHost.refreshPlugins(pluginDiscovery.discover())
      runtime = createAgentRuntime(request, this.pluginHost)
    } catch (error) {
      // 刷新或 runtime 装配失败：表现为 send() 拒绝（便于调用方重试），并清理注册避免误判"运行中"。
      if (this.workers.get(input.sessionId) === worker) this.workers.delete(input.sessionId)
      if (this.cancellations.get(input.sessionId) === cancellation) {
        this.cancellations.delete(input.sessionId)
      }
      if (this.activeSinks.get(input.sessionId) === sink) this.activeSinks.delete(input.sessionId)
      throw error
    }
    void this.runScheduledTasks(worker, request, runtime, track, streamSink, cancellation.signal)
      .catch((error) => {
        // 轮次间的刷新/装配失败：终结本次流（error + end），避免会话被卡在"运行中"。
        // 注意用原始 sink：编排错误需要 error 与 end 都发出（worker 内部错误才只 error 不 end）。
        if (terminated) return
        terminated = true
        sink.error(error)
        sink.end()
      })
      .finally(() => {
        // 轮次间会替换 worker，故此处按会话清理（不再比对具体 worker 引用）。
        this.workers.delete(input.sessionId)
        if (this.cancellations.get(input.sessionId) === cancellation) {
          this.cancellations.delete(input.sessionId)
        }
        if (this.activeSinks.get(input.sessionId) === sink) this.activeSinks.delete(input.sessionId)
      })
  }

  private async runScheduledTasks(
    firstWorker: AgentWorker,
    request: { sessionId: string; cwd: string; message: UIMessage; modelConfig?: AgentModelConfig },
    firstRuntime: AgentOptions,
    track: SessionTrack,
    sink: AgentSink,
    signal: AbortSignal
  ): Promise<void> {
    let worker = firstWorker
    let runtime = firstRuntime
    // 每轮的消息：undefined = 在主链上续跑（不新增消息）。首轮是用户消息。
    let message: UIMessage | undefined = request.message
    let nested = false
    // 递归各轮是独立上下文，各轮 totalProcessingMs 彼此独立——在编排层累加，回填到最后一轮。
    let baseProcessingMs = 0
    // 递归模型：
    // - 某轮调度了**顶层任务**（首次进入，或子任务完成后「回父」）→ 下一轮在主链上续跑
    //   （nested=false、message=undefined，从主链末尾那条 `agent_schedule_task` 之后继续）。
    // - 某轮调度了**更深的子任务** → 下一轮下探（nested=true，独立上下文，只喂该 task.md 判据）。
    // - 某轮没再调度 → 结束。
    // 是否已经"回到主链"过一次。已在主链上却又调度顶层任务 = 原地打转，必须终止，
    // 否则会无限循环（实测：反复调度同一顶层任务可跑满 50+ 轮仍不停）。
    let resumed = false
    for (;;) {
      // cancel() 会中止本信号；据此在轮次间停止继续递归。
      // 必须显式结束流：在**轮次之间**取消时（例如编排层正 await refreshPlugins），
      // cancel() 拿到的 worker 已跑完本轮（其 controller 已清空），worker.cancel() 走
      // "closed=true 但不通知"的分支，不会发 end。若这里只 return 不 end，主进程侧就永远
      // 不发 agent:end，会话在（不依赖渲染层自行收尾的）调用方看来会卡在"运行中"。
      if (signal.aborted) {
        sink.end()
        return
      }
      const result = await worker.run({ ...request, message, runtime, nested, baseProcessingMs })
      if (result.totalProcessingMs !== undefined) baseProcessingMs = result.totalProcessingMs
      const taskFile = result.scheduled
      if (taskFile === undefined) return
      if (isTopLevelTaskFile(taskFile)) {
        // 已在主链上（上一次就是回主链续跑）却又调度顶层任务 → 原地打转，终止。
        // 该轮已调度过任务、worker 未自行 end，故这里显式结束流，避免 UI 卡在"运行中"。
        if (resumed) {
          sink.end()
          return
        }
        // 回到主任务：在主链上续跑（不新增消息）。
        resumed = true
        nested = false
        message = undefined
      } else {
        // 下探子任务会重置"已回主链"标记（下一层可能再回主链一次）。
        resumed = false
        // 下探子任务：独立上下文，只喂本轮 nest 判据（compaction：UI 不把它当用户气泡渲染；
        // nested：模型输入隔离）。
        nested = true
        message = {
          id: randomUUID(),
          role: 'user',
          metadata: { nested: true, compaction: true },
          parts: [{ type: 'text', text: buildNestPrompt(taskFile) }]
        }
      }
      // 准备下一轮：刷新磁盘插件（增量 diff，让新上下文/续写立即可见新增/修改/删除的 MCP server）、
      // 重建 runtime、清读状态。每轮新建 worker：worker 在自己那一轮未调度任务时会 finish()
      // （closed=true），同一 worker 无法再跑下一轮。跨轮复用 track（文件变更延续）。
      await this.pluginHost.refreshPlugins(pluginDiscovery.discover())
      runtime = createAgentRuntime(request, this.pluginHost)
      clearReadState(request.sessionId)
      worker = new AgentWorker(this.sessions, sink, this.pluginHost, track)
      this.workers.set(request.sessionId, worker)
    }
  }

  cancel(sessionId: string): void {
    const worker = this.workers.get(sessionId)
    if (!worker) return
    this.workers.delete(sessionId)
    // 先中止跨轮信号，避免编排层在 cancel 后继续启动已排队的子任务。
    this.cancellations.get(sessionId)?.abort()
    worker.cancel()
  }

  dispose(): void {
    for (const worker of this.workers.values()) worker.cancel()
    this.workers.clear()
    for (const cancellation of this.cancellations.values()) cancellation.abort()
    this.cancellations.clear()
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
