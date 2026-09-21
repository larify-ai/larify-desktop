import type { UIMessage, UIMessageChunk } from 'ai'
import { randomUUID } from 'node:crypto'
import { clearReadState } from '../../../extensions/fs/main/state'
import type { SessionStore } from '../session'
import type { AgentModelConfig } from '../model/config'
import type { AgentOptions } from './engine'
import { markNested, runStoredAgentSession } from './persist'
import { AgentReview, FileChangeTracker, reviewChunk } from './review'
import type { PluginHost } from '../plugin/host'
import { pluginDiscovery } from '../plugin/plugin-discovery'

const reviewTools = new Set(['fs_edit', 'fs_write'])
const resetContextTool = 'agent_reset_context'
const scheduleTaskTool = 'agent_schedule_task'

export interface AgentWorkerInput {
  sessionId: string
  cwd: string
  /** 本轮的输入消息：首轮是用户消息，被调度任务的轮次是 nest 判据，ask_user 续写是回答。 */
  message?: UIMessage
  runtime: AgentOptions
  /** 复用本次会话模型配置（携带 apiKey 时标题生成同样直连官方）。 */
  modelConfig?: AgentModelConfig
  /** 递归子任务轮次：其消息仅 UI 可见，不进主链上下文。 */
  nested?: boolean
  /** 递归前几轮已累计的处理时长（ms）。 */
  baseProcessingMs?: number
  /** 上一轮 assistant 的落库身份（ask_user 回答续写时由 agent.ts 下传，用于原地替换）。 */
  previousStored?: UIMessage
  /**
   * ask_user 回答续写时，该**子任务轮**的 nest 判据（由 agent.ts 按 toolCallId 精确回溯下传）。
   * 有值时，本轮模型输入 = `[判据, 回答]`（从该子任务轮继续），而非「只有回答」。
   */
  continuationPrompt?: UIMessage
}

/** 一轮的产出：被调度的任务路径（一轮至多一个），以及该轮（含传入基数）的累计处理时长。 */
export interface AgentRunResult {
  scheduled?: string
  totalProcessingMs?: number
}

export interface SessionTrack {
  cwd: string
  review: AgentReview
  tracker: FileChangeTracker
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
    private readonly sink: AgentSink,
    private readonly pluginHost: PluginHost,
    private readonly track?: SessionTrack
  ) {}

  async run(input: AgentWorkerInput): Promise<AgentRunResult> {
    if (this.controller || this.closed) return {}
    const controller = new AbortController()
    this.controller = controller
    // 严格单任务：一轮只认第一个 schedule_task。任务结构是单链树（每个任务至多一个子任务，
    // 「回父」由模型在子任务完成时再调一次 schedule_task(父) 实现），一轮多调度属违规
    // （模型在同一响应里并行调了多次），只取首个、忽略其余。
    let scheduled: string | undefined
    let totalProcessingMs: number | undefined
    try {
      // ask_user 回答/reset_context 都是同一任务的续写：追踪器由 Agent 按会话持有，
      // 跨 worker 复用（track?.review/track?.tracker），不会因为新 worker 而丢文件。
      const activeReview =
        this.track?.review ??
        new AgentReview(input.cwd, (chunk) => {
          if (!controller.signal.aborted) this.sink.chunk(chunk)
        })
      const fileChanges = this.track?.tracker ?? new FileChangeTracker()
      // 每轮结束时把当前任务快照写回持久化：
      // runStoredAgentSession 的 onMessage 只保存流内消息（不含 review part），
      // 会覆盖掉上一轮已持久化的快照；这里把最新快照（同 id 原地替换）写回，
      // 保证"ask_user 前改的文件"在重载/切换会话后仍然可见。
      const saveReview = (response: UIMessage): void => {
        // Reconcile once more before persisting so a file deleted after the
        // last tool output still surfaces as a deletion in the final card.
        for (const tracked of fileChanges.syncResults()) {
          activeReview.update(tracked)
        }
        const snapshot = activeReview.finish()
        if (!snapshot) return
        const chunk = reviewChunk(snapshot)
        // 变更卡片挂在**主链 assistant** 上：子任务轮（nested）的落库身份是那条 UI 私有的
        // `-nested` 行，若把快照写在其上，主链消息（卡片只渲染它）就永远看不到变更——这正是
        // 「调度任务后变更卡片不更新」的成因。因此子任务轮改写到主链那条（即它的 UI 锚点：
        // 主链轮不改 start，故 `lastAssistant` 拿到的就是主链 assistant），使其变更回流到卡片。
        const target = input.nested
          ? (this.sessions.lastAssistant(input.sessionId, 'after') ?? response)
          : response
        const existingIndex = target.parts.findIndex(
          (part) => part.type === 'data-git-snapshot' && part.id === 'review'
        )
        if (existingIndex >= 0) {
          target.parts[existingIndex] = chunk as (typeof target.parts)[number]
        } else {
          target.parts.push(chunk as (typeof target.parts)[number])
        }
        // target 已是**落库身份**，直接按同 id 原地替换快照 part 即可。
        this.sessions.saveMessages(input.sessionId, [target])
      }
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
      const schedule = toolsContext[scheduleTaskTool]
      if (schedule) {
        toolsContext[scheduleTaskTool] = {
          ...(schedule as Record<string, unknown>),
          scheduleTask: (taskPath: string) => {
            scheduled ??= taskPath
          }
        }
      }
      const reviewToolCalls = new Set<string>()
      const originalStopWhen = input.runtime.stopWhen
      // `previousStored`（要写回的那条既有 assistant）**由调用方显式给出**，不由 message 反推：
      // - ask_user 回答续写（外部 `agent:send` 送来回答）：由 `agent.ts` 从锚点下传 ⇒ 写回原行。
      // - reset_context 的进程内续写：传**本轮的判据**（见 `while (handoff)` 内说明）⇒ 本轮
      //   落库换新 id（`toStored` 的重定向），从而落在 `sessions.start` 之后、可被续写。
      const runOnce = (
        message: UIMessage | undefined,
        previousStored?: UIMessage
      ): Promise<UIMessage | undefined> =>
        runStoredAgentSession(this.sessions, {
          sessionId: input.sessionId,
          cwd: input.cwd,
          message,
          modelConfig: input.modelConfig,
          nested: input.nested,
          baseProcessingMs: input.baseProcessingMs,
          previousStored,
          continuationPrompt: input.continuationPrompt,
          options: {
            ...input.runtime,
            toolsContext,
            abortSignal: controller.signal,
            stopWhen: async (options) =>
              handoff !== undefined ||
              scheduled !== undefined ||
              (originalStopWhen ? await originalStopWhen(options) : false)
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
              if (
                output &&
                typeof output === 'object' &&
                typeof (output as { path?: unknown }).path === 'string'
              ) {
                // Sync every tracked file (including ones deleted outside the
                // tracked tools, e.g. via the terminal) into the review card.
                for (const tracked of fileChanges.syncResults()) {
                  activeReview.update(tracked)
                }
              }
            } else if (
              chunk.type === 'tool-input-error' ||
              chunk.type === 'tool-output-error' ||
              chunk.type === 'tool-output-denied'
            ) {
              reviewToolCalls.delete(chunk.toolCallId)
            }
          }
        })
      // 每轮结束后统一收尾：写回变更快照、累计处理时长。
      const settle = (value: UIMessage | undefined): void => {
        if (value) saveReview(value)
        const total = (value?.metadata as Record<string, unknown> | undefined)?.totalProcessingMs
        if (typeof total === 'number' && Number.isFinite(total)) totalProcessingMs = total
      }
      // 首条输入可能携带「续写身份」（ask_user 回答要写回原行）。
      let response = await runOnce(input.message, input.previousStored)
      settle(response)
      // reset_context 的进程内续写：新的一轮，故不传续写身份。
      while (handoff) {
        if (controller.signal.aborted) return { scheduled, totalProcessingMs }
        // reset 续写轮的输入 = **本轮的「用户输入」+ 交接摘要**（parts=2），而非复刻任意前序内容。
        //
        // `agent_reset_context.handoff` 按工具契约就是「交接摘要」（`Markdown handoff document
        // with related files linked`）——摘要**自足**：它已把「已改文件 / 下一步」写成文本。
        // 保留「本轮的用户输入」是为了让判据行仍带**任务语境**（与真实库 15 条历史正常判据行一致：
        // 形态恒为 `[上一轮输入文本, '# Handoff\n\n<摘要>']`，parts=2）。
        //
        // ⚠️ 只取 **`role === 'user'` 的 `input.message.parts`**，绝不无条件复刻 `input.message`：
        // `input.message` 在**不同轮次语义不同**，无非复刻会出错：
        // - 首轮 / nest 判据轮：`agent.ts` 用 `buildNestPrompt` 造的 1-part 判据 ⇒ 正确保留。
        // - **续写（ask_user 回答）轮：`input.message` 是渲染层 `addToolOutput` 回传的整条
        //   assistant 快照（数百 parts）** ⇒ 若复刻，就把整条 assistant 正文写进一条 **user** 行，
        //   产出「role=user 却载 assistant 正文」的**嵌合行**，并随快照规模线性放大。
        //   真实会话 `8b152a1c` 的 `#6702/#6704/#6706/#6708`（419/461 parts）即此。
        //   ⇒ 这同时是「同一 toolCallId 出现在 4 条 user 行 ⇒ 调度次数虚高」的来源。
        //   故此处用 `input.message.role === 'user'` 把它**排除**（assistant 快照不带入）。
        const carriedParts =
          input.message?.role === 'user' ? (input.message.parts ?? []) : []
        const tagged: UIMessage = {
          id: randomUUID(),
          role: 'user',
          metadata: { compaction: true },
          parts: [...carriedParts, { type: 'text', text: `# Handoff\n\n${handoff}` }]
        }
        // 本轮判据同时是**续写轮的 `previousStored`**：reset 续写是新的一轮（worker 只跑一轮），
        // 其落库身份必须由调用方显式给出，不能由 SDK 从 `message` 反推。
        //
        // 理由：`runStoredAgentSession` 用 `originalMessages = [...messages, continuationOf]`
        // 并入 reset 前那条 assistant 以复用其 id（AI SDK 据此把产出并进那条 UI 消息，时长连续）。
        // 而 `messages` = `loadMessages()`（`position >= sessions.start`）+ 本轮判据；主链轮里
        // `messages` **恒以一个 user 结尾**，于是 AI SDK 的 `handleUIMessageStreamFinish` 会把
        // `continuationOf.id`（reset 前的旧 assistant）当作**流内 start chunk 的 messageId**，
        // 整个 `state.message`（含全部增量）都挂在那条 id 上 —— 而它已被 `saveStart` 甩到
        // `start` 之前。若不重定向，本轮的新产出（最后一个 `agent_schedule_task` /
        // `agent_ask_user`）就**永远落不进 `loadMessages()` 可见的范围**（同既有缺陷
        // `ask-user-reanswer-after-reset` 的形态，只是触发在**流内 start 注入**这一层）。
        // 显式传入后 `previousStored.id !== continuationOf.id` ⇒ `toStored` 的重定向生效，
        // UI 侧 `originalMessages` 不变（合并与时长语义不变），仅落库改到一个新 id。
        const message = input.nested ? markNested(tagged) : tagged
        handoff = undefined
        // reset_context 走进程内 handoff，不经过 Agent.send()，故此处显式刷新
        // 磁盘插件（增量 diff），让"重置上下文"后的续写立即可见新增/修改/删除的
        // MCP server。await：reset 本就是重置语义，阻塞等刷新完再续写。
        await this.pluginHost.refreshPlugins(pluginDiscovery.discover())
        clearReadState(input.sessionId)
        // 只有主链轮次才移动 `sessions.start`（reset 的截断游标）：`start` 决定
        // `loadMessages` 的主链上下文边界。子任务（nested）走独立上下文（只喂本轮
        // nest prompt），不依赖 `start`；若在此也 saveStart，会把主链游标推到子任务的
        // 位置，使主链上下文被截断成残片（实测 loadMessages 返回 []）。故 nested 时跳过。
        if (!input.nested) this.sessions.saveStart(input.sessionId, message)
        // `previousStored` 只在**主链轮**传：其用途是「落库 id 重定向」——主链续写轮 `messages`
        // 恒以 user 结尾，AI SDK 会把 reset 前那条旧 assistant 的 id 当作流内 start 的
        // messageId，其产出会被甩到 `sessions.start` 之前。显式传入判据（id ≠ continuationOf.id）
        // ⇒ `toStored` 重定向生效，产出落在 `start` 之后。
        //
        // ⚠️ **nested 轮不能传**：`toStored` 的 nested+锚点分支会**复用锚点 id** 落库
        // （`markNested({...response, id: continuationAnchor.id})`），若把本轮 handoff 行当锚点
        // 传入，续写产出将**覆盖 handoff 行本身**（handoff 行消失）。nested 轮不需要移动游标
        // （`start` 不动），其落库已按「主链行为 id 基」正常新建行。
        response = await runOnce(message, input.nested ? undefined : message)
        settle(response)
      }
      // 照常结束流：`ask_user` 是客户端工具，AI SDK 侧本轮到此为止；用户回答会经
      // `addToolOutput` 再次 `agent:send`。上下文（nested / 已累计时长）由 agent.ts 在
      // 收到回答时从"上一条 assistant"的 metadata 恢复，无需让流在此保持开启
      // （保持开启会让 UI 永远停在"运行中"，进程重启后彻底卡死）。
      // 本轮正常跑完：**不在此结束流**。worker 只负责一轮，无从知道本轮之后编排层是否还有
      // 被调度的任务要跑。若提前 sink.end()，渲染端 transport 会置 `finished=true` 并关闭
      // ReadableStream，后续轮次的 chunk 会被全部丢弃（表现为「已完成 + 变更卡片，但没有回复文本」）。
      // 故：正常结束只置 closed（不再写入），由编排层 `runScheduledTasks` 在整条链结束时统一 end。
      // abort 时跳过：cancel() 已自行 end 过，此处再置 closed 会掩盖后续状态（保持与原语义一致）。
      if (!controller.signal.aborted) this.finish(() => {})
      return { scheduled, totalProcessingMs }
    } catch (error) {
      // abort 是用户主动停止（cancel()），预期路径，不按错误留痕。
      // 主进程留痕：agent 运行级错误（非流内部，如工具执行/持久化失败）。
      if (!controller.signal.aborted) {
        console.error('[agent] run failed:', error)
        this.finish(() => this.sink.error(error))
      }
      return { scheduled, totalProcessingMs }
    } finally {
      if (this.controller === controller) this.controller = undefined
    }
  }

  cancel(): void {
    if (this.closed) return
    // 尚未 run()（例如在 send() 等待插件/OAuth 刷新期间被取消）：标记关闭，
    // 让 run() 直接跳过，避免刷新完成后继续执行本次消息。
    if (!this.controller) {
      this.closed = true
      return
    }
    this.controller.abort()
    this.finish(() => this.sink.end())
  }

  private finish(notify: () => void): void {
    if (this.closed) return
    this.closed = true
    notify()
  }
}
