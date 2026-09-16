import type { UIMessage } from 'ai'
import { randomUUID } from 'node:crypto'
import type { Disposable } from '@shared/infra/disposable'
import { larifyWorkspacePath } from '../../utils/app-paths'
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
 * 判定「上一条 assistant 是否正停在 agent_ask_user 等待回答」。ask_user 是客户端工具
 * （无 execute），其回答经 `addToolOutput` 再次 `agent:send`；服务端据此识别"这是续写"
 * 而非新一轮提问，从而保留原轮的上下文（nested / 已累计时长）。
 */
function awaitUserAnswer(sessions: SessionStore, sessionId: string): boolean {
  // 必须用 lastMessage（**不过滤 nested**）：ask_user 常出现在**子任务轮**（nested）里，
  // 而 lastAssistant 会把 nested 消息排除掉——用它判定会漏掉子任务轮的 ask_user，
  // 于是"调度→子任务轮问用户→没停→继续回主链"，用户回答时流程已跑偏（消息末尾是 nest 判据）。
  const last = sessions.lastMessage(sessionId)
  if (!last || last.role !== 'assistant') return false
  const parts = last.parts ?? []
  const lastStep = parts.findLastIndex((part) => part.type === 'step-start')
  return parts
    .slice(lastStep + 1)
    .some(
      (part) =>
        (part as { type?: string }).type === 'tool-agent_ask_user' &&
        (part as { state?: string }).state === 'input-available'
    )
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
    // 每轮的消息：主链轮是用户消息（首轮）或不新增消息（回主链）；独立上下文轮是本任务的 nest 判据。
    let message: UIMessage | undefined = request.message
    // 当前是否在主链：主链轮（用户可感知的会话线）为 false，独立上下文轮为 true。
    // 首轮在主链；「回主链」= 重置回这个初始状态（nested=false、message=undefined）。
    let nested = false
    // 各轮是独立上下文，totalProcessingMs 彼此独立——在编排层累加，回填到最后一轮。
    let baseProcessingMs = 0
    // 「等待用户回答」的续写恢复：ask_user 是**客户端工具**（无 execute），其回答经
    // `addToolOutput` → 又一次 `agent:send` 送达。渲染层只发回答（没有新 user 文本），
    // 服务端若当作全新一轮，就会 nested=false、base=0 —— 于是子任务轮的续写被误当成
    // 「主链轮」且时长从零重算。这里从**上一条 assistant 自身**恢复上下文（nested 与已累计
    // 时长都写在其 metadata 上），无需任何额外持久化：
    const resumedFlag = awaitUserAnswer(this.sessions, request.sessionId)
    const resumed = request.message.role === 'assistant' && resumedFlag
    if (resumed) {
      // 同样用 lastMessage：ask_user 所在的轮次可能是 nested，其 metadata 才是要恢复的
      // nested / totalProcessingMs 来源。
      const previous = this.sessions.lastMessage(request.sessionId)
      // 仅恢复**上下文归属与已累计时长**；`message` 必须保留——用户的回答（tool-output）
      // 要作为新消息喂给模型，才能与上一轮的 ask_user(tool-call) 配对；置空会触发
      // 「Tool result is missing for tool call」。
      nested = (previous?.metadata as Record<string, unknown> | undefined)?.nested === true
      const total = (previous?.metadata as Record<string, unknown> | undefined)?.totalProcessingMs
      if (typeof total === 'number' && Number.isFinite(total)) baseProcessingMs = total
    }
    // 编排模型（唯一规则，不区分任务层级）：
    // - 某轮**调度了** task.md(X) → 下一轮在 **X 自己的独立上下文**里跑（nested=true、喂 nest 判据）。
    //   不论是下探子任务，还是子任务「回父」再调度父任务，都走这里。
    // - 某轮**没调度** → 该任务跑完：若已在**主链**则结束；否则**回主链**（nested=false、
    //   message=undefined，即回到与首轮相同的状态）——"调度 → 独立上下文跑 → 没调度则回主链"
    //   这一循环，由模型在判据里用 `agent_schedule_task` 驱动，直到主链轮也不调度才真正结束。
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
      if (taskFile === undefined) {
        // 没调度 → 该任务跑完：已在主链 → 结束；否则回主链（回到与首轮相同的初始状态）。
        // 本轮停在「等待用户回答」(agent_ask_user 仍为等待态)：**暂停**，不回主链、不结束。
        // ask_user 是客户端工具，用户回答经 addToolOutput 再次 send() 续写；此处若继续
        // （尤其 nested 轮会"回主链"），回答就会被当成新轮次，上下文与时长都被重置。
        if (awaitUserAnswer(this.sessions, request.sessionId)) return
        if (!nested) return
        nested = false
        message = undefined
      } else {
        // 调度了 → 下一轮独立上下文，只喂该 task.md 的 nest 判据
        // （compaction：UI 不把它当用户气泡渲染；nested：模型输入隔离）。
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
