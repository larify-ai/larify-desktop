import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

const workspace = mkdtempSync(join(tmpdir(), 'nested-own-run-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

/**
 * 守门测试：**嵌套轮 ask_user 被回答后的续写轮，必须带上「本嵌套轮自己的运行记录」**。
 *
 * 背景：判据（`nest/prompt.md`）开头是「To complete the current task `<task.md>`, follow the
 * workflow below」，第 1 步即「读 task.md、按 Before/While 执行」。若续写输入只有 `[判据, 回答]`，
 * 模型看不到自己跑到哪 ⇒ **从 workflow 起点重跑**（实测真实会话 `c9ea2e13#7215` 答完 ask_user 后
 * 又重读 task.md、重新采集；全库 25 例）。修法＝输入取**承载行**（`previousStored`）的已有 parts。
 *
 * 本测试锁三条不变量（任一被破坏即回归）：
 * ① **带历史**：承载行已跑过的工具调用 / 文本 / 工具结果必须出现在输入里；
 * ② **不越权**：主链内容**不得**出现在输入里；
 * ③ **回答落回 + 落库形态**：`ask_user` 变 `output-available`、嵌套行原地替换（id 不变、
 *    `nested=true`、不新增行）、主链行不被污染。
 *
 * 关联知识：`memory/larify-desktop/nested-continuation-reads-own-run-design.md`、
 * `memory/larify-desktop/ask-user-replays-nest-prompt-restarts-workflow.md`。
 */
describe('嵌套续写：读「本嵌套轮自己的运行记录」', () => {
  let store: SessionStore
  const sessionId = 's-own-run'
  const cwd = workspace

  const text = (v: string): UIMessage['parts'][number] => ({ type: 'text', text: v })
  const stepStart = (): UIMessage['parts'][number] => ({ type: 'step-start' })
  const toolCall = (id: string, name: string, input: unknown, output: unknown): UIMessage['parts'][number] =>
    ({ type: `tool-${name}`, toolCallId: id, state: 'output-available', input, output }) as never
  const ask = (id: string, state: string, extra: Record<string, unknown> = {}): UIMessage['parts'][number] =>
    ({ type: 'tool-agent_ask_user', toolCallId: id, state, input: { question: 'q' }, ...extra }) as never

  const openStores: SessionStore[] = []
  beforeEach(() => {
    store = new SessionStore(join(workspace, `own-${Math.random().toString(36).slice(2)}.db`))
    openStores.push(store)
    store.createSession({ cwd, id: sessionId, title: 'own-run' })
  })
  afterEach(() => {
    for (const s of openStores.splice(0)) s.dispose()
  })

  const rowById = (id: string): UIMessage | undefined =>
    store.loadVisibleMessages(sessionId).find((m) => m.id === id)

  it('①带历史 ②不越权 ③回答落回：三条不变量同时成立', async () => {
    // 主链（含"机密"串：若被带进嵌套输入，② 断言会红）
    store.saveMessages(sessionId, [
      { id: 'u-main', role: 'user', parts: [text('调研一下')] } as UIMessage,
      {
        id: 'main-anchor',
        role: 'assistant',
        parts: [text('MAINCHAIN-SECRET-'.repeat(50)), toolCall('cm', 'fs_read', { path: '/m.md' }, { ok: 1 })]
      } as UIMessage
    ])
    // 承载行：本嵌套轮已跑过「读 task.md + 搜索 + 结论」，末尾停在 ask_user
    store.saveMessages(sessionId, [
      {
        id: 'main-anchor-nested-A',
        role: 'assistant',
        metadata: { nested: true },
        parts: [
          stepStart(),
          text('先读当前任务'),
          toolCall('c1', 'fs_read', { path: '/tasks/x/task.md' }, { content: 'CARRIED-TASKMD' }),
          stepStart(),
          toolCall('c2', 'browser_web_search', { query: 'CARRIED-QUERY' }, { results: ['r'] }),
          text('CARRIED-CONCLUSION'),
          ask('ask-n', 'input-available')
        ]
      } as UIMessage
    ])
    const nestPrompt: UIMessage = {
      id: 'nest-prompt',
      role: 'user',
      metadata: { nested: true, compaction: true },
      parts: [text('To complete the current task `/tasks/x/task.md`, follow the workflow below: …')]
    }
    store.saveMessages(sessionId, [nestPrompt])

    const nestedRow = rowById('main-anchor-nested-A')!
    // 渲染层快照（真实形态：id = 主链锚点、含回答）
    const snapshot: UIMessage = {
      id: 'main-anchor',
      role: 'assistant',
      parts: [
        text('MAINCHAIN-SECRET-'.repeat(50)),
        ask('ask-n', 'output-available', { output: { answers: ['继续'] } })
      ]
    }

    const captured: unknown[][] = []
    const model = new MockLanguageModelV4({
      doStream: async (options: { prompt: unknown[] }) => {
        captured.push(options.prompt)
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] })
              c.enqueue({ type: 'text-start', id: 't1' })
              c.enqueue({ type: 'text-delta', id: 't1', delta: 'NEW-ROUND' })
              c.enqueue({ type: 'text-end', id: 't1' })
              c.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
              })
              c.close()
            }
          })
        }
      }
    })

    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model } as never,
      nested: true,
      previousStored: nestedRow,
      continuationPrompt: nestPrompt,
      answeredToolCallId: 'ask-n',
      message: snapshot
    })

    const input = JSON.stringify(captured)

    // ① 带历史
    //    ★ 并且：去掉末尾「等待态」ask part 后，**问题内容不得丢** ——
    //    回答 part（output-available）自带 input(问题)+output(回答)，转 prompt 后生成
    //    `tool-call`(含问题) + `tool-result`(含回答) 一对。故这里断言「问题文本 + 回答」都在。
    expect(input, '问题内容（ask_user 的 input）必须保留').toContain('ask_user')
    expect(input, '工具调用配对：tool-call 必须存在').toContain('"type":"tool-call"')
    expect(input, '工具调用配对：tool-result 必须存在').toContain('"type":"tool-result"')
    expect(input, '应带上承载行读过的 task.md 输出').toContain('CARRIED-TASKMD')
    expect(input, '应带上承载行搜过的关键词').toContain('CARRIED-QUERY')
    expect(input, '应带上承载行已得的结论').toContain('CARRIED-CONCLUSION')
    expect(input, '应含判据').toContain('follow the workflow below')
    expect(input, '应含回答').toContain('继续')

    // ② 不越权
    expect(input, '不得携带主链内容').not.toContain('MAINCHAIN-SECRET')

    // ③ 回答落回 + 落库形态
    const carrier = rowById('main-anchor-nested-A')!
    const asks = (carrier.parts ?? [])
      .filter((p) => (p as { type: string }).type === 'tool-agent_ask_user')
      .map((p) => `${(p as { toolCallId?: string }).toolCallId}:${(p as { state?: string }).state}`)
    expect(asks).toContain('ask-n:output-available')
    expect(asks).not.toContain('ask-n:input-available')
    // 原地替换：id 不变、nested 保留、无新增嵌套行
    expect(carrier.id).toBe('main-anchor-nested-A')
    expect(carrier.metadata?.nested).toBe(true)
    expect(
      store.loadVisibleMessages(sessionId).filter((m) => m.metadata?.nested === true && m.role === 'assistant')
    ).toHaveLength(1)
    // 主链行未被污染
    const mainRow = rowById('main-anchor')!
    expect((mainRow.parts ?? []).some((p) => (p as { type: string }).type === 'tool-agent_ask_user')).toBe(false)
  })

  it('超长承载行：**不截断**（历史完整），且无孤儿 tool-result', async () => {
    store.saveMessages(sessionId, [
      { id: 'main-anchor', role: 'assistant', parts: [text('主链')] } as UIMessage
    ])
    // 承载行 ~208 万字符（远超触发守门的规模）。**刻意不截断**：它是本嵌套轮的真实运行记录，
    // 截它即丢历史；且实测最坏情况（151 万字符 ≈62 万 estTokens）仍 < 模型可用输入上限（84 万）
    // ⇒ 请求能发出，超阈值时由通用守门（`prepareStep`）插提示让模型 reset（见
    // `memory/larify-desktop/nested-continuation-reads-own-run-design.md`）。
    const big: UIMessage['parts'] = []
    for (let i = 0; i < 100; i += 1) {
      big.push(stepStart(), toolCall(`t${i}`, 'fs_read', { content: `OUT-${i}-`.repeat(3000) }))
    }
    big.push(stepStart(), text('末步结论-LAST'), ask('ask-n', 'input-available'))
    store.saveMessages(sessionId, [
      { id: 'main-anchor-nested-A', role: 'assistant', metadata: { nested: true }, parts: big } as UIMessage
    ])
    const nestedRow = rowById('main-anchor-nested-A')!
    const nestPrompt: UIMessage = {
      id: 'nest-prompt',
      role: 'user',
      metadata: { nested: true, compaction: true },
      parts: [text('判据：To complete the current task `/tasks/x/task.md` …')]
    }
    store.saveMessages(sessionId, [nestPrompt])

    const captured: unknown[][] = []
    const model = new MockLanguageModelV4({
      doStream: async (options: { prompt: unknown[] }) => {
        captured.push(options.prompt)
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] })
              c.enqueue({ type: 'text-start', id: 't1' })
              c.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' })
              c.enqueue({ type: 'text-end', id: 't1' })
              c.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
              })
              c.close()
            }
          })
        }
      }
    })

    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model } as never,
      nested: true,
      previousStored: nestedRow,
      continuationPrompt: nestPrompt,
      answeredToolCallId: 'ask-n',
      message: {
        id: 'main-anchor',
        role: 'assistant',
        parts: [text('主链'), ask('ask-n', 'output-available', { output: { answers: ['继续'] } })]
      } as UIMessage
    })

    const prompt = captured[0] as Array<{ role: string; content: unknown }>
    const all = JSON.stringify(prompt)
    // 历史完整：最早的步与末步都在（证明没被截断）
    expect(all, '最早的工具输出应在（未截断）').toContain('OUT-0-')
    expect(all, '末步结论应在').toContain('末步结论-LAST')
    expect(all, '回答应在').toContain('继续')

    // 配对完整性：每个 tool-result 都要有配对的 tool-call
    const calls = new Set<string>()
    const results: string[] = []
    for (const m of prompt) {
      for (const part of m.content as Array<Record<string, unknown>>) {
        if (part.type === 'tool-call') calls.add(String(part.toolCallId))
        if (part.type === 'tool-result') results.push(String(part.toolCallId))
      }
    }
    expect(results.filter((id) => !calls.has(id)), '不得出现孤儿 tool-result').toHaveLength(0)
  })

  it('遗留脏数据：承载行堆积多个 input-available ⇒ 不能报「缺 tool result」', async () => {
    // 旧缺陷（nested-ask-user-answer-not-landed）会在同一行堆积多个 input-available 的 ask
    // （真实 `da3ad8bb#6921` 有 8 个）。一旦这些 part 进 prompt，就会变成「有 tool-call 却无
    // tool-result」⇒ AI SDK 报 `Tool results are missing for tool calls …` 并**中断整个流**。
    // 本用例锁死「喂承载行历史后必须清掉所有等待态 ask」。
    store.saveMessages(sessionId, [
      { id: 'main-anchor', role: 'assistant', parts: [text('主链')] } as UIMessage,
      {
        id: 'main-anchor-nested-A',
        role: 'assistant',
        metadata: { nested: true },
        parts: [
          stepStart(),
          ask('stale1', 'input-available'),
          stepStart(),
          text('中间结论'),
          ask('stale2', 'input-available'), // 本轮回答它
          stepStart(),
          ask('stale3', 'input-available')
        ]
      } as UIMessage
    ])
    const nestedRow = rowById('main-anchor-nested-A')!
    const nestPrompt: UIMessage = {
      id: 'nest-prompt',
      role: 'user',
      metadata: { nested: true, compaction: true },
      parts: [text('判据')]
    }
    store.saveMessages(sessionId, [nestPrompt])

    const captured: unknown[][] = []
    const errors: string[] = []
    const model = new MockLanguageModelV4({
      doStream: async (options: { prompt: unknown[] }) => {
        captured.push(options.prompt)
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] })
              c.enqueue({ type: 'text-start', id: 't1' })
              c.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' })
              c.enqueue({ type: 'text-end', id: 't1' })
              c.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
              })
              c.close()
            }
          })
        }
      }
    })

    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model } as never,
      nested: true,
      previousStored: nestedRow,
      continuationPrompt: nestPrompt,
      answeredToolCallId: 'stale2',
      message: {
        id: 'main-anchor',
        role: 'assistant',
        parts: [text('主链'), ask('stale2', 'output-available', { output: { answers: ['本轮答'] } })]
      } as UIMessage,
      onChunk: (chunk) => {
        if ((chunk as { type?: string }).type === 'error') errors.push(String(chunk))
      }
    })

    const prompt = (captured[0] ?? []) as Array<{ role: string; content: unknown[] }>
    const calls: string[] = []
    const results: string[] = []
    for (const m of prompt) {
      for (const part of m.content as Array<Record<string, unknown>>) {
        if (part.type === 'tool-call') calls.push(String(part.toolCallId))
        if (part.type === 'tool-result') results.push(String(part.toolCallId))
      }
    }
    expect(results.filter((id) => !calls.includes(id)), '不得有孤儿 tool-result').toHaveLength(0)
    expect(calls.filter((id) => id === 'stale2'), 'stale2 只应出现一次').toHaveLength(1)
    // 等待态残留会让 AI SDK 报缺 result；这里断言模型输入里没有孤立 tool-call
    expect(calls.sort()).toEqual(results.sort())
  })

  it('对照：主链轮续写行为不变（加载整条主链历史、回答落回主链行）', async () => {
    store.saveMessages(sessionId, [
      { id: 'u-main', role: 'user', parts: [text('把名字做成点云')] } as UIMessage,
      {
        id: 'main-row',
        role: 'assistant',
        parts: [stepStart(), text('MAIN-HISTORY'), ask('ask-m', 'input-available')]
      } as UIMessage
    ])
    const mainRow = rowById('main-row')!
    const snapshot: UIMessage = {
      id: 'main-row',
      role: 'assistant',
      parts: [stepStart(), text('MAIN-HISTORY'), ask('ask-m', 'output-available', { output: { answers: ['中文'] } })]
    }

    const captured: unknown[][] = []
    const model = new MockLanguageModelV4({
      doStream: async (options: { prompt: unknown[] }) => {
        captured.push(options.prompt)
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] })
              c.enqueue({ type: 'text-start', id: 't1' })
              c.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' })
              c.enqueue({ type: 'text-end', id: 't1' })
              c.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
              })
              c.close()
            }
          })
        }
      }
    })

    await runStoredAgentSession(store, {
      sessionId,
      cwd,
      options: { model } as never,
      previousStored: mainRow,
      answeredToolCallId: 'ask-m',
      message: snapshot
    })

    expect(JSON.stringify(captured)).toContain('MAIN-HISTORY')
    const asks = (rowById('main-row')?.parts ?? [])
      .filter((p) => (p as { type: string }).type === 'tool-agent_ask_user')
      .map((p) => `${(p as { toolCallId?: string }).toolCallId}:${(p as { state?: string }).state}`)
    expect(asks).toContain('ask-m:output-available')
  })
})
