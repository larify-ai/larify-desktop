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
  // 于是"调度→子任务轮问用户→没停→继续跑下一轮"，用户回答时流程已跑偏（消息末尾是 nest 判据）。
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

/**
 * 从**渲染层送来的消息**里读出「**已终态**的 `agent_ask_user`」的 `toolCallId` 列表。
 *
 * ask_user 是客户端工具（无 execute）；用户提交回答走 `addToolOutput(toolCallId, output)`，
 * 它把回答写进**当前 assistant** 的 ask_user part（state → `output-available`/`output-error`/
 * `output-denied`），随后 `makeRequest` 把这条消息经 `agent:send` 发来。
 *
 * 注意：一条 assistant 内可能有**多个**终态 ask_user（历史里早答过的 + 本次刚答的），
 * 仅凭 state **无法**区分哪个是本次的。因此这里只返回**候选**；由调用方按
 * 「**库内该 `toolCallId` 仍是 `input-available`**」逐个校验，取第一个命中者（见 `runScheduledTasks`）。
 */
function answeredAskUserCallIds(message: UIMessage): string[] {
  if (message.role !== 'assistant') return []
  const asks = (message.parts ?? []).filter((part) => {
    const tool = part as { type?: string; toolName?: string }
    return (
      tool.type === 'tool-agent_ask_user' ||
      (tool.type === 'dynamic-tool' && tool.toolName === 'agent_ask_user')
    )
  }) as Array<{ toolCallId?: string; state?: string }>
  return asks
    .filter(
      (part) =>
        typeof part.toolCallId === 'string' &&
        (part.state === 'output-available' ||
          part.state === 'output-error' ||
          part.state === 'output-denied')
    )
    .map((part) => part.toolCallId as string)
}

export interface AgentInput {
  sessionId: string
  cwd?: string
  message: UIMessage
  modelConfig?: AgentModelConfig
  /**
   * 渲染端指定的「本轮输出应并入的 UI 消息 id」（= 渲染端此刻的末端 assistant id；新提问轮为
   * `undefined`）。主进程整条链（含被调度任务的 nest 轮、reset 内部轮）复用它，使「本轮该并进
   * 哪条 UI 消息」只有一个权威（渲染端），不再从数据库反推 ⇒ 消除 UI 重复（详见 `persist.ts`）。
   */
  uiTargetId?: string
  /** 用户配置的记忆目录远程仓库地址（设置项，可为空）；注入系统提示词。 */
  memoryRepo?: string
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
    // 多轮共享同一 sink；`end` 只由编排层在**整条链真正结束**时发一次（worker 不自行 end——
    // 它只负责一轮，无从知道本轮之后是否还有被调度的任务）。这里保证幂等。
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
    request: AgentInput & { cwd: string },
    firstRuntime: AgentOptions,
    track: SessionTrack,
    sink: AgentSink,
    signal: AbortSignal
  ): Promise<void> {
    let worker = firstWorker
    let runtime = firstRuntime
    // 渲染端指定的 UI 目标 id：本轮及后续被调度任务轮（nest）**全链复用同一个**。`send()` 传入，
    // 新提问轮为 `undefined`；首轮跑完后由 worker 回报「本轮实际发给渲染层的 id」补齐（见下）。
    let uiTargetId = request.uiTargetId
    // 每轮的消息：首轮是用户消息；被调度任务的轮次是该任务的 nest 判据；
    // ask_user 回答续写时是渲染层送来的 tool-output（assistant）。
    let message: UIMessage | undefined = request.message
    // 本轮是否用**独立上下文**：为真时模型输入只有本轮 `message`（不加载主链历史），
    // 使各任务上下文互相隔离。被调度任务的轮次为真；主链轮与 ask_user 续写按其来源决定。
    let nested = false
    // 各轮是独立上下文，totalProcessingMs 彼此独立——在编排层累加，回填到最后一轮。
    let baseProcessingMs = 0
    // 「等待用户回答」的续写恢复：ask_user 是**客户端工具**（无 execute），其回答经
    // `addToolOutput` → 又一次 `agent:send` 送达。渲染层只发回答（没有新 user 文本），
    // 服务端若当作全新一轮，就会 nested=false、base=0 —— 于是子任务轮的续写被误当成
    // 「主链轮」且时长从零重算。
    //
    // **精确回溯（不走位置推断）**：渲染层送来的消息**自带**被回答的 `ask_user.toolCallId`；
    // 以「**库内该 toolCallId 仍是 `input-available`**」为准逐个校验候选，命中者即
    // 「谁在等这次回答」——它可能是主链行或嵌套行。之所以不用 `lastMessage()`（「最近写进来
    // 的一条」）：主链与嵌套链交错写入时会错位（子任务 ask_user 之后又写入 nest 判据/主链轮），
    // 导致子任务轮续写被误判为主链轮 ⇒ 越权读整条主链。
    let askUserContext: { owner: UIMessage; prompt?: UIMessage } | undefined
    // 命中「谁在等这次回答」的 toolCallId：下传给 persist，用于从渲染层快照里**只抽回答 part**
    // （否则续写输入会把整条主链快照拖进来——实测 `e2212cc1` ≈14.2 万 tokens）。
    let answeredToolCallId: string | undefined
    for (const callId of answeredAskUserCallIds(request.message)) {
      askUserContext = this.sessions.findAskUserContext(request.sessionId, callId)
      if (askUserContext) {
        answeredToolCallId = callId
        break
      }
    }
    const resumedOwner = askUserContext?.owner
    // 以下三者都只对**本轮**生效（续写完成后即恢复常规取值），故用 `let` 并在每轮末清空：
    // - `continuationPrompt`：该子任务轮的 nest 判据（「从该轮继续」而非只看孤立回答）；
    // - `answeredToolCallId`：persist 据此从快照里只抽回答 part；
    // - `previousStored`：要写回/重定向的那条既有 assistant（在 `if (resumed)` 里赋值）。
    let continuationPrompt = askUserContext?.prompt
    // 判定本轮是否为「续写」。两路**互补**：
    // ① 精确回溯命中（新）：`owner` 可能是**嵌套行**——此时 `lastMessage()` 未必是它，
    //    旧判据会漏判；这正是本次修复点。
    // ② 旧判据（兜底）：DB 末条停在等待态。用于「找不到承载者」（历史数据/异常）时保持原行为。
    const resumed =
      resumedOwner !== undefined ||
      (request.message.role === 'assistant' && awaitUserAnswer(this.sessions, request.sessionId))
    // 续写要**写回上一轮那条 assistant**（原地替换），故把它的落库身份一路下传到 persist。
    // 只有这里知道"上一轮的落库身份"：渲染层传来的 message 是**主链 assistant** 的快照
    // （嵌套行在 UI 上合并进主链消息），既不含嵌套行 id、也推不出增量切片基准。
    let previousStored: UIMessage | undefined
    if (resumed) {
      // 优先用精确回溯到的承载者；找不到才退回 lastMessage（兜底）。
      const previous = resumedOwner ?? this.sessions.lastMessage(request.sessionId)
      previousStored = previous
      // 仅恢复**上下文归属与已累计时长**；`message` 必须保留——用户的回答（tool-output）
      // 要作为新消息喂给模型，才能与上一轮的 ask_user(tool-call) 配对；置空会触发
      // 「Tool result is missing for tool call」。
      nested = (previous?.metadata as Record<string, unknown> | undefined)?.nested === true
      const total = (previous?.metadata as Record<string, unknown> | undefined)?.totalProcessingMs
      if (typeof total === 'number' && Number.isFinite(total)) baseProcessingMs = total
    }
    // 编排模型（唯一规则，不区分任务层级）：
    // - 某轮**调度了** task.md(X) → 下一轮在 **X 自己的独立上下文**里跑（nested=true、喂 nest 判据）。
    //   下探子任务、子任务「回父」再调度父任务（多层嵌套），都走这里——故嵌套层数不受限。
    // - 某轮**没调度** → 该任务跑完，**整条链结束**（不再额外驱动一轮）。
    // 即："调度 → 独立上下文跑" 这一循环由模型在判据里用 `agent_schedule_task` 驱动，
    // 直到某轮不再调度为止。
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
      const result = await worker.run({
        ...request,
        message,
        runtime,
        nested,
        baseProcessingMs,
        previousStored,
        continuationPrompt,
        answeredToolCallId,
        uiTargetId
      })
      // 续写只对**本轮**生效：续写完成后就是普通轮次，锚点回到正常取值。
      previousStored = undefined
      continuationPrompt = undefined
      answeredToolCallId = undefined
      if (result.totalProcessingMs !== undefined) baseProcessingMs = result.totalProcessingMs
      // 记住「本轮实际发给渲染层的 UI id」：新提问轮为 `undefined` 时，用它给后续被调度任务轮
      // （nest）当 `uiTargetId` ⇒ 主链 + 子任务共用的仍是**同一条 UI 消息**，全链恒 replace。
      if (result.uiMessageId !== undefined) uiTargetId = result.uiMessageId
      // 本轮停在「等待用户回答」(agent_ask_user 仍为等待态)：**暂停**，不结束流。
      // ask_user 是客户端工具，用户回答经 addToolOutput 再次 send() 续写；此处若结束，
      // 回答就会被当成新轮次，上下文与时长都被重置。
      // **必须优先于 `scheduled` 判定**：模型可能在同一响应里既提问又调度（例如先问用户
      // "是否开始"，同时把任务挂上）。若因有调度就继续跑下一轮，那个提问会被绕过——用户
      // 回答时流程已跑到别处，回答被当作新一轮主链续写（实测：`#3203` 遗留一张"等待回答"
      // 的卡片，用户回答后又跑了一整轮主链）。
      // 注意（本循环的**三个 return 分支都必须 end 流**：signal.aborted / 等待回答 / 未调度）：
      // worker 不自行 end，故**流的唯一正常结束点在这里**。漏掉任一分支都会让会话停在"运行中"。
      if (awaitUserAnswer(this.sessions, request.sessionId)) {
        sink.end()
        return
      }
      const taskFile = result.scheduled
      if (taskFile === undefined) {
        // 没调度 → 该任务跑完，整条链结束（不再额外跑一轮「回主链」）。
        sink.end()
        return
      }
      // 调度了 → 下一轮独立上下文，只喂该 task.md 的 nest 判据
      // （compaction：UI 不把它当用户气泡渲染；nested：模型输入隔离）。
      // 判据极简（只说"完成哪个 task.md"）；如何完成/何时回父统一由系统提示词的 Workflow 指导。
      nested = true
      message = {
        id: randomUUID(),
        role: 'user',
        metadata: { nested: true, compaction: true },
        parts: [{ type: 'text', text: buildNestPrompt(taskFile) }]
      }
      // 准备下一轮：刷新磁盘插件（增量 diff，让新上下文/续写立即可见新增/修改/删除的 MCP server）、
      // 重建 runtime、清读状态。每轮新建 worker：worker 在自己那一轮不再自行 end 流（见 worker.ts），
      // 故同一 worker 不再受 closed 限制前，这里按轮重建以保证每轮状态干净。跨轮复用 track（文件变更延续）。
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
