import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'reset-single-row-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 复刻真实会话 `7a2df69b` 的形态：**主链轮 reset_context 的进程内 handoff 续写**。
 *
 * 现象（修复前）：每一轮 reset 续写都**新建一条 assistant 行**，其 parts = 上一条（reset 前）
 * 的全部 parts + 本轮增量 ⇒ 同一轮里出现「相邻 assistant 超集链」⇒ UI 把同一批 progress 标题
 * 各显示多遍（用户报告「每一项都重复」）。
 *
 * 不变量（修复后必须成立）：
 *   **同一轮（同一个非 compaction user 之后）内，可见 assistant 行数 = 1**；
 *   且该行**包含全部内容**（= 历史上各段的并集），无信息丢失。
 */
describe('reset 续写：同一轮只应有一条可见 assistant 行', () => {
  const sessionId = 's-single-row'
  const cwd = workspace
  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })

  /** 产出若干 stage + 可选 reset_context（触发 worker 的进程内 handoff）。 */
  const streamOf = (
    titles: string[],
    opts: { reset?: boolean; prefix: string }
  ): MockLanguageModelV4 =>
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            titles.forEach((t, i) => {
              controller.enqueue({ type: 'text-start', id: `${opts.prefix}t${i}` })
              controller.enqueue({ type: 'text-delta', id: `${opts.prefix}t${i}`, delta: `内容 ${t}` })
              controller.enqueue({ type: 'text-end', id: `${opts.prefix}t${i}` })
              const cid = `${opts.prefix}sp-${i}`
              controller.enqueue({
                type: 'tool-input-start',
                id: cid,
                toolName: 'agent_show_progress'
              })
              controller.enqueue({
                type: 'tool-input-delta',
                id: cid,
                delta: JSON.stringify({ title: t })
              })
              controller.enqueue({ type: 'tool-input-end', id: cid })
            })
            if (opts.reset) {
              const rid = `${opts.prefix}reset`
              controller.enqueue({
                type: 'tool-input-start',
                id: rid,
                toolName: 'agent_reset_context'
              })
              controller.enqueue({
                type: 'tool-input-delta',
                id: rid,
                delta: JSON.stringify({ handoff: '交接摘要' })
              })
              controller.enqueue({ type: 'tool-input-end', id: rid })
            }
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
            })
            controller.close()
          }
        })
      })
    })

  let store: SessionStore
  const openStores: SessionStore[] = []
  beforeEach(() => {
    store = new SessionStore(join(workspace, `m-${Math.random().toString(36).slice(2)}.db`))
    openStores.push(store)
    store.createSession({ cwd, id: sessionId, title: 'single-row' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  const spTitles = (m: UIMessage): string[] =>
    m.parts.filter((p) => p.type === 'tool-agent_show_progress').map((p) => p.input.title)

  /** 一轮 = 一个非 compaction 的 user 行之后的所有可见行。 */
  const visibleTurns = (): { user: UIMessage; assistants: UIMessage[] }[] => {
    const msgs = store.loadVisibleMessages(sessionId)
    const turns: { user: UIMessage; assistants: UIMessage[] }[] = []
    for (const m of msgs) {
      const compaction = (m.metadata as Record<string, unknown> | undefined)?.compaction === true
      if (m.role === 'user' && !compaction) turns.push({ user: m, assistants: [] })
      else if (m.role === 'assistant' && turns.length) turns.at(-1)!.assistants.push(m)
    }
    return turns
  }

  it('主链轮含 reset 时：同一轮可见 assistant 行 = 1，且内容不丢', async () => {
    // 主链轮：产出 A,B + reset_context（触发 handoff）
    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model: streamOf(['A', 'B'], { reset: true, prefix: 'r1' }) } as never,
      message: { id: 'u1', role: 'user', parts: [text('提问1')] } as UIMessage
    })

    // 模拟 worker 的 handoff 续写轮（主链轮 reset 会 saveStart + 传 previousStored）
    const compactionUser: UIMessage = {
      id: 'comp-1',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('提问1'), text('# Handoff\n\n交接摘要')]
    }
    store.saveStart(sessionId, compactionUser)
    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model: streamOf(['C', 'D'], { prefix: 'r2' }) } as never,
      message: compactionUser,
      previousStored: compactionUser
    })

    const turns = visibleTurns()
    console.log('可见轮数 =', turns.length)
    turns.forEach((t) =>
      console.log(
        `  user=${t.user.id} assistants=${t.assistants.length} ::`,
        t.assistants.map((a) => `[${a.id.slice(0, 14)} sp=${spTitles(a).join(',')}]`).join(' ')
      )
    )

    expect(turns.length, '应只有 1 轮（1 个非 compaction 用户提问）').toBe(1)
    const assistants = turns[0].assistants
    // ★ 核心断言：同一轮只应有一条可见 assistant 行（当前实现会得到 2 条 ⇒ 红）
    expect(assistants.length, '同一轮出现了多条可见 assistant 行 ⇒ UI 会重复').toBe(1)

    // 内容不丢：最终可见的那条应含全部标题 A,B,C,D
    const finalTitles = spTitles(assistants[0])
    expect(finalTitles).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D']))
  })

  it('连续两次 reset（复刻 d764fc88 的多行链）：最终仍只剩 1 行、无同名标题重复', async () => {
    // 轮1：A,B + reset
    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model: streamOf(['A', 'B'], { reset: true, prefix: 't1' }) } as never,
      message: { id: 'u1', role: 'user', parts: [text('提问')] } as UIMessage
    })
    // handoff 续写 1：C + reset（再次 reset）
    const comp1: UIMessage = {
      id: 'c1',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('提问'), text('# Handoff\n\n摘要1')]
    }
    store.saveStart(sessionId, comp1)
    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model: streamOf(['C'], { reset: true, prefix: 't2' }) } as never,
      message: comp1,
      previousStored: comp1
    })
    // handoff 续写 2：D
    const comp2: UIMessage = {
      id: 'c2',
      role: 'user',
      metadata: { compaction: true },
      parts: [text('提问'), text('# Handoff\n\n摘要2')]
    }
    store.saveStart(sessionId, comp2)
    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model: streamOf(['D'], { prefix: 't3' }) } as never,
      message: comp2,
      previousStored: comp2
    })

    const turns = visibleTurns()
    expect(turns.length).toBe(1)
    const assistants = turns[0].assistants
    console.log(
      '两次 reset 后可见 assistants =',
      assistants.length,
      assistants.map((a) => `[${a.id.slice(0, 12)} sp=${spTitles(a).join(',')}]`).join(' ')
    )
    expect(assistants.length, '连续 reset 后仍应只留 1 行').toBe(1)
    // 同名标题不得重复
    const titles = spTitles(assistants[0])
    const counts = titles.reduce<Record<string, number>>((acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})
    expect(Object.values(counts).filter((c) => c > 1), '同名标题重复').toEqual([])
  })
})
