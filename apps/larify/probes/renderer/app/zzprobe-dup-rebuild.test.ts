/**
 * 对照实验：判定「UI 每一项出现两个（每项都重复）」的**必要条件**。
 *
 * 两个假设：
 *  H1（Chat 重建 / 覆盖 messages）：Chat 的 messages **被输入流之外的路径替换**为
 *     「DB 历史 + 已累积 live 超集」，于是同一内容出现两份 ⇒ 与现场「17+16=33、其中 16 个各两遍」吻合。
 *  H2（单流内 push）：仅靠「主进程流内 start id 与渲染层末条一致」的契约即可避免重复
 *     —— 若是契约缺陷，应在**单一输入流**内也复现。
 *
 * 本探针用真实 `@ai-sdk/react` 的 `Chat`：
 *  - A 组：单流内把「主链(16 阶段) + 嵌套(3 阶段)」喂给 Chat（真实合并路径）⇒ 检查重复。
 *  - B 组：先喂「主链(16 阶段)，未含嵌套」的 DB 快照（= 切走时的落库形态），
 *          再喂「主链(17 阶段)」的完整快照（= 切回时从 DB 载入的**超集**）⇒ 检查重复。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Chat } from '@ai-sdk/react'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

const LOG: string[] = []
const log = (s: string): void => void LOG.push(s)

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
  totalTokens: 2
}

/** 构造一条 assistant 消息：N 个 show_progress 阶段（每个前面一段 text，等价于 activity item）。 */
function stageMessage(id: string, titles: string[]): UIMessage {
  const parts: UIMessage['parts'] = []
  titles.forEach((t, i) => {
    parts.push({ type: 'text', text: `内容${i}` } as never)
    parts.push({
      type: 'tool-agent_show_progress',
      state: 'output-available',
      input: { title: t, toolCallTitle: t },
      toolCallId: `${id}_s${i}`,
      output: 'ok'
    } as never)
  })
  return { id, role: 'assistant', parts, metadata: { startedAt: 1, completedAt: 2 } }
}

function userMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

/** 把一条「完整 assistant 消息」转成流（start + text/tool chunks + finish）。 */
function messageToChunks(taskId: string, titles: string[]): UIMessageChunk[] {
  const out: UIMessageChunk[] = [{ type: 'start', messageId: taskId } as never]
  titles.forEach((t, i) => {
    out.push({ type: 'text-start', id: `${taskId}_t${i}` } as never)
    out.push({ type: 'text-delta', id: `${taskId}_t${i}`, delta: `内容${i}` } as never)
    out.push({ type: 'text-end', id: `${taskId}_t${i}` } as never)
    out.push({
      type: 'tool-input-available',
      toolCallId: `${taskId}_s${i}`,
      toolName: 'agent_show_progress',
      input: { title: t, toolCallTitle: t }
    } as never)
    out.push({
      type: 'tool-output-available',
      toolCallId: `${taskId}_s${i}`,
      output: 'ok'
    } as never)
  })
  out.push({ type: 'finish' } as never)
  return out
}

function streamOf(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    }
  })
}

/** 数「活动历史各 stage 标题的出现次数」（等价于 DOM 折叠头计数）。 */
function stageCounts(messages: UIMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const p of m.parts) {
      if (p.type === 'tool-agent_show_progress') {
        const t = (p as { input?: { title?: string } }).input?.title ?? ''
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
  }
  return counts
}

const T16 = Array.from({ length: 16 }, (_, i) => `阶段${i + 1}`)
const T17 = [...T16, '第17阶段']
const T3 = ['子A', '子B', '子C']

describe('对照实验：重复的必要条件', () => {
  it('A 组：单流内「主链(16) + 嵌套(3)」⇒ 是否重复', async () => {
    // 一个 transport 的两次请求：第一次主链 16、第二次嵌套 3（模拟多轮编排在同一 send 内）
    let call = 0
    const scripts: UIMessageChunk[][] = [messageToChunks('MAIN', T16), messageToChunks('MAIN', T3)]
    const transport: ChatTransport<UIMessage> = {
      async sendMessages() {
        const chunks = scripts[Math.min(call, scripts.length - 1)]
        call += 1
        return streamOf(chunks)
      },
      async reconnectToStream() {
        return null
      }
    }
    const chat = new Chat<UIMessage>({ id: 's', messages: [], transport })
    await chat.sendMessage({ text: 'go' })

    log('\n=== A 组：单 send 内主链(16)→嵌套(3) ===')
    log('  messages = ' + JSON.stringify(chat.messages.map((m) => ({ id: m.id.slice(0, 22), role: m.role, parts: m.parts.length }))))
    const counts = stageCounts(chat.messages)
    let dup = 0
    for (const t of [...T16, ...T3]) {
      const c = counts.get(t) ?? 0
      if (c > 1) dup += 1
      log(`    ${c}  ← ${t}`)
    }
    log(`  ⇒ 出现次数 > 1 的标题数 = ${dup}`)
    const ids = chat.messages.filter((m) => m.role === 'assistant').map((m) => m.id)
    log(`  assistant 条数=${ids.length} 唯一=${new Set(ids).size}`)
  }, 30000)

  it('B 组：先喂 DB 快照(16 阶段) → 再喂「完整快照」(17 阶段，含 16 个重复) ⇒ 是否复现', async () => {
    // 这是「Chat 的 messages 被输入流之外覆盖为 DB 历史」的等价形态：
    // DB 快照 1 = 主链 16 阶段（尚未含第 17）
    // DB 快照 2 = 主链 17 阶段（含 16 个）
    // live 已累积 = 主链 17 阶段（含 16 个）
    // ⇒ 若用 DB 快照 2 覆盖 live ⇒ 不重复（二者同源）
    // ⇒ 若把「DB 快照 1」与「live 17」混入同一列表 ⇒ 16 个各两遍（复现现场）
    const snap1 = [userMessage('U1', 'go'), stageMessage('MAIN', T16)]
    const snap2 = [userMessage('U1', 'go'), stageMessage('MAIN', T17)]

    // B1：直接以 snap2 为初值（= 从 DB 载入完整历史，无 live 残留）
    const chat1 = new Chat<UIMessage>({ id: 's', messages: snap2 })
    log('\n=== B1：仅 DB 完整快照(17 阶段) ===')
    log('  messages = ' + JSON.stringify(chat1.messages.map((m) => ({ id: m.id.slice(0, 22), role: m.role, parts: m.parts.length }))))
    let c1 = stageCounts(chat1.messages)
    log(`  阶段1 出现 ${c1.get('阶段1')} 次；阶段17 出现 ${c1.get('第17阶段')} 次`)

    // B2：把「DB 快照 1」与「live 完整(17)」放进同一列表（= 覆盖时未去重/未替换，而是拼接）
    const merged = [...snap1, ...snap2]
    const chat2 = new Chat<UIMessage>({ id: 's', messages: merged })
    log('\n=== B2：DB 快照(16) 与 live 完整(17) **拼接**在 同一列表 ===')
    log('  messages = ' + JSON.stringify(chat2.messages.map((m) => ({ id: m.id.slice(0, 22), role: m.role, parts: m.parts.length }))))
    const c2 = stageCounts(chat2.messages)
    let dup2 = 0
    for (const t of T17) {
      const c = c2.get(t) ?? 0
      if (c > 1) dup2 += 1
      log(`    ${c}  ← ${t}`)
    }
    log(`  ⇒ 出现次数 > 1 的标题数 = ${dup2} / 17   （现场为 16/17）`)

    // B3：同一 id 的两条消息（ON CONFLICT 去重域）拼接 —— 观察 SDK 是否去重
    const sameId = [stageMessage('MAIN', T16), stageMessage('MAIN', T17)]
    const chat3 = new Chat<UIMessage>({ id: 's', messages: sameId })
    log('\n=== B3：同 id 的两条 assistant（DB 去重域相同） ===')
    log('  messages = ' + JSON.stringify(chat3.messages.map((m) => ({ id: m.id.slice(0, 22), role: m.role, parts: m.parts.length }))))
    const c3 = stageCounts(chat3.messages)
    log(`  阶段1 出现 ${c3.get('阶段1')} 次；阶段17 出现 ${c3.get('第17阶段')} 次`)
    expect(true).toBe(true)
  }, 30000)
})

afterAll(() => {
  console.log('\n\n========== rebuild 对照实验输出 ==========')
  for (const line of LOG) console.log(line)
})
