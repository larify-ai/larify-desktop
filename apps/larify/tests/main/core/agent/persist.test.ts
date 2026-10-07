import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  prepare: vi.fn(),
  run: vi.fn(),
  title: vi.fn()
}))

vi.mock('../../../../src/main/core/session/save', () => ({
  saveSessionMessages: mocks.save
}))
vi.mock('../../../../src/main/core/agent/messages', () => ({
  prepareMessages: mocks.prepare
}))
vi.mock('../../../../src/main/core/agent/session', () => ({
  runAgentSession: mocks.run
}))
vi.mock('../../../../src/main/core/session/title', () => ({
  generateSessionTitle: mocks.title
}))
vi.mock('../../../../src/main/core/model', () => ({
  createModel: vi.fn(() => 'model')
}))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'

const user: UIMessage = {
  id: 'user',
  role: 'user',
  parts: [{ type: 'text', text: 'hello' }]
}
// 「计划模式」开启时，渲染层会在本轮用户消息上携带 `workflowPrefix` 标记（送模型时才拼前缀，
// text 保持原文）。默认关闭 ⇒ 不带该标记。
const userWithWorkflow: UIMessage = {
  ...user,
  metadata: { workflowPrefix: true }
}
const assistant: UIMessage = {
  id: 'assistant',
  role: 'assistant',
  parts: [{ type: 'text', text: '你好' }]
}
const history: UIMessage = {
  id: 'history',
  role: 'assistant',
  parts: [{ type: 'text', text: 'earlier' }]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepare.mockResolvedValue([history, user])
  mocks.title.mockResolvedValue('Greeting')
})

describe('runStoredAgentSession', () => {
  it('saves the request and each completed step', async () => {
    const finalAssistant = { ...assistant, metadata: { startedAt: 1, completedAt: 2 } }
    mocks.run.mockImplementation(async (_messages, _options, _onChunk, onMessage) => {
      onMessage(assistant)
      return [history, user, finalAssistant]
    })
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [history, user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    const result = await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      options: {} as never
    })

    // 默认关闭：不带 workflowPrefix 的用户输入**原样落库**（不加前缀）。
    expect(mocks.save).toHaveBeenNthCalledWith(1, sessions, 'session', 'cwd', [user], undefined)
    expect(sessions.loadMessages).toHaveBeenCalledWith('session')
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.loadMessages.mock.invocationCallOrder[0]
    )
    expect(mocks.prepare).toHaveBeenCalledWith([history, user])
    expect(sessions.saveMessages).toHaveBeenNthCalledWith(1, 'session', [assistant])
    expect(sessions.saveMessages).toHaveBeenNthCalledWith(2, 'session', [finalAssistant])
    expect(mocks.save).toHaveBeenCalledOnce()
    // 返回值＝落库身份 + 卡片目标行（**行 id 与内容基线同源**，见 `StoredRunResult`）
    // + 本轮实际发给渲染层的 UI id（`uiMessageId`；无 `uiTargetId` 时 = 末条产出 id）。
    // 主链轮：目标行即本轮产出自身（含其全部 parts）。
    expect(result).toEqual({
      stored: finalAssistant,
      reviewRowId: 'assistant',
      reviewRow: finalAssistant,
      uiMessageId: 'assistant'
    })
  })

  it('feeds a recursive child only its own prompt, ignoring stored history', async () => {
    mocks.run.mockResolvedValue([user])
    const mainAssistant: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main work' }]
    }
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [history, user]),
      lastAssistant: vi.fn(() => mainAssistant),
      // UI 锚点取「渲染层此刻的末端 assistant」（不过滤 nested）；首轮嵌套时它就是主链行。
      lastVisibleAssistant: vi.fn(() => mainAssistant),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      nested: true,
      options: {} as never
    })

    // 子任务不从库读**模型上下文**：输入只有本轮 message。
    expect(sessions.loadMessages).not.toHaveBeenCalled()
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.run.mock.calls[0][0]).toEqual([user])
    // 但 UI 身份锚定渲染层末端 assistant（末尾 assistant）→ 渲染端复用其 id、合并成一条，
    // 不再新建一条带旧 parts 的副本（曾导致 UI 重复父轮阶段）。
    expect(sessions.lastVisibleAssistant).toHaveBeenCalledWith('session')
    expect(mocks.run.mock.calls[0][4]).toEqual([mainAssistant])
  })

  it('stores the nested round with its own id and nested flag (never clobbering the main-chain assistant)', async () => {
    // UI 身份锚定主链 assistant 后，AI SDK 返回的是**合并消息**（id=anchor、parts=anchor+delta）。
    // 必须换算为「新 id + nested 标记」再落库，否则会用嵌套标记覆盖主链行。
    const anchor: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'main a' },
        { type: 'text', text: 'main b' }
      ]
    }
    const merged: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [...anchor.parts, { type: 'text', text: 'child delta' }]
    }
    mocks.run.mockImplementation(async (_messages, _options, _onChunk, onMessage) => {
      onMessage(merged)
      return [merged]
    })
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [anchor]),
      lastAssistant: vi.fn(() => anchor),
      lastVisibleAssistant: vi.fn(() => anchor),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    const result = await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      // nested 轮的 message 是内部 nest 判据（会被 saveSessionMessages 存为新 user）。
      message: { id: 'nest', role: 'user', parts: [{ type: 'text', text: 'nest prompt' }] },
      nested: true,
      options: {} as never
    })

    // 落库：id 换新、带 nested 标记、**只存本轮增量**（新建嵌套轮：基线是上一轮行，SDK 克隆其
    // parts 后纯追加本轮新增 ⇒ 从基线长度起切即得增量）。id 形如 `main-nested-<uuid>`：**每轮唯一**，
    // 避免多轮嵌套（回父/重入/续写）因 `ON CONFLICT(session_id,id) DO UPDATE` 互相覆盖。
    const stored = sessions.saveMessages.mock.calls.at(-1)?.[1]?.[0] as UIMessage
    expect(stored.id).toMatch(/^main-nested-.+/)
    expect(stored.metadata).toMatchObject({ nested: true })
    // ⚠️ 只存增量（= `merged` 去掉基线 `anchor.parts`）：否则每轮复制一份历史，长子任务链行体积
    // 单调膨胀（真实会话 `825617b9` 12 轮 38K→333K tokens）。此切片**仅用于新建嵌套轮**——该路径
    // 是纯追加；**续写路径不切片**（否则会吞掉 AI SDK 原地改写的 ask_user 回答，见
    // nested-continuation-keeps-ask-user 与 withAnsweredTool）。
    expect(stored.parts).toEqual([{ type: 'text', text: 'child delta' }])
    // 返回值即落库身份（供 worker 快照回写复用），卡片挂主链行。
    expect(result?.stored.id).toBe(stored.id)
    expect(result?.reviewRowId).toBe('main')
    // ★ 卡片内容基线必须是**主链行自身**（无 nested、不含嵌套私货）——而非嵌套行的 `stored`：
    // 若二者混用，嵌套标记会被写进主链行、使主链助手被 `loadMessages` 过滤而消失。
    expect(result?.reviewRow).toEqual(anchor)
    expect((result?.reviewRow.metadata as { nested?: boolean } | undefined)?.nested).toBeUndefined()
    // 绝不按 anchor 的 id 回写（否则覆盖主链行）。
    for (const [, messages] of sessions.saveMessages.mock.calls) {
      for (const m of messages as UIMessage[]) {
        if (m.role === 'assistant') expect(m.id).not.toBe('main')
      }
    }
  })

  it('gives each nested round a distinct id so successive rounds never clobber each other', async () => {
    // 回归：anchor（主链 assistant）在整段嵌套期间不变，故 `value.id` 每轮相同。
    // 若落库 id 固定为 `${id}-nested`，第二轮会覆盖第一轮 —— 表现为「判据行不断累积、
    // assistant 只有最后一条」。这里连续跑两轮嵌套，断言两轮落库 id 不同。
    const anchor: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main work' }]
    }
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [anchor]),
      lastAssistant: vi.fn(() => anchor),
      lastVisibleAssistant: vi.fn(() => anchor),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
    const runRound = async (delta: string): Promise<string> => {
      const merged: UIMessage = {
        id: 'main',
        role: 'assistant',
        parts: [...anchor.parts, { type: 'text', text: delta }]
      }
      mocks.run.mockImplementation(async (_m, _o, _c, onMessage) => {
        onMessage(merged)
        return [merged]
      })
      await runStoredAgentSession(sessions as never, {
        sessionId: 'session',
        cwd: 'cwd',
        message: { id: `nest-${delta}`, role: 'user', parts: [{ type: 'text', text: delta }] },
        nested: true,
        options: {} as never
      })
      return (sessions.saveMessages.mock.calls.at(-1)?.[1]?.[0] as UIMessage).id
    }

    const first = await runRound('round one')
    const second = await runRound('round two')
    expect(first).not.toBe(second)
    expect(first).toMatch(/^main-nested-.+/)
    expect(second).toMatch(/^main-nested-.+/)
  })

  it('anchors a later nested round to the renderer’s actual last assistant, not the main-chain row', async () => {
    // Red 复现：UI 整段内容重复（nest 锚点取错）。
    //
    // 现象（CDP 读运行实例 live state）：live messages 里同一条主链 assistant 的 id
    // 出现两次，后者是前者的**超集副本**（parts 70 → 267）⇒ 界面整段重复、刷新即消失。
    //
    // 机制：nest 轮的 UI 身份锚点取 `sessions.lastAssistant(sessionId, 'after')`，
    // 而它带 `metadata.nested IS NOT 1` 过滤 ⇒ **恒返回主链行**（id=`main`）。
    // 但渲染层此刻的**末端 assistant 是上一轮的嵌套行**（id=`main-nested-<uuid>`）。
    // AI SDK 只把锚点 id 盖到流上；客户端 `replaceLastMessage = 流id === 自己末端id`
    // ⇒ 不等 ⇒ pushMessage（新建），并把锚点全部 parts 当基线复制 ⇒ 重复。
    //
    // 首个嵌套轮时渲染层末端**正好还是主链行**，故正常；**第二个起必重复**。
    // 本测试模拟「第二个嵌套轮」：库内既有的「最后一条可见 assistant」是上一轮的嵌套行。
    const mainRow: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main work' }]
    }
    const previousNestedRow: UIMessage = {
      id: 'main-nested-prev-uuid',
      role: 'assistant',
      metadata: { nested: true },
      parts: [{ type: 'text', text: 'previous nested round' }]
    }
    mocks.run.mockResolvedValue([previousNestedRow])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [mainRow]),
      // 当前实现（主链行，过滤 nested）——这正是缺陷所在。
      lastAssistant: vi.fn(() => mainRow),
      // 渲染层末端 assistant（含 nested）——锚点应当与它一致。
      lastVisibleAssistant: vi.fn(() => previousNestedRow),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { id: 'nest', role: 'user', parts: [{ type: 'text', text: 'nest prompt 2' }] },
      nested: true,
      options: {} as never
    })

    const uiOriginalMessages = mocks.run.mock.calls[0][4] as UIMessage[]
    // ★ 锚点必须等于**渲染层此刻的末端 assistant**，否则客户端会新建一条 ⇒ UI 重复。
    expect(uiOriginalMessages).toEqual([previousNestedRow])
    expect(uiOriginalMessages.at(-1)?.id).toBe('main-nested-prev-uuid')
  })

  it('never marks an assistant continuation as nested (would clobber the main-chain row)', async () => {
    // 该 message 的 role=assistant 且 **id 与主链 assistant 相同**（渲染层把 tool-output
    // 追加到当前 assistant）。若 tag 给它也打 nested，saveSessionMessages 会以
    // `ON CONFLICT(session_id,id) DO UPDATE` 用 `{id: 主链 id, nested:true}` **覆盖主链行**；
    // loadMessages 会过滤 nested → 重启（从 DB 重载）后主链消息消失 → 对话错乱。
    const mainAssistant: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'work' }]
    }
    mocks.run.mockResolvedValue([mainAssistant])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [mainAssistant]),
      lastAssistant: vi.fn(() => undefined),
      lastVisibleAssistant: vi.fn(() => undefined),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: mainAssistant,
      nested: true,
      options: {} as never
    })

    // assistant 续写消息原样落库：id 不变、**不带 nested**。
    expect(mocks.save).toHaveBeenCalledWith(sessions, 'session', 'cwd', [mainAssistant], undefined)
  })

  it('still marks an internal nested user prompt as nested', async () => {
    // 对照：递归子任务的内部输入（nest 判据 / compaction handoff）是 user 消息，
    // 必须打 nested 标记——它才是「不进主链上下文」的那条。
    const nestPrompt: UIMessage = {
      id: 'nest',
      role: 'user',
      metadata: { compaction: true },
      parts: [{ type: 'text', text: 'task.md path + workflow' }]
    }
    mocks.run.mockResolvedValue([])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => []),
      lastAssistant: vi.fn(() => undefined),
      lastVisibleAssistant: vi.fn(() => undefined),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: nestPrompt,
      nested: true,
      options: {} as never
    })

    const stored = mocks.save.mock.calls[0][3][0] as UIMessage
    expect(stored.id).toBe('nest')
    expect(stored.metadata).toMatchObject({ nested: true, compaction: true })
  })

  it('feeds the top level the stored main-chain history', async () => {
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [history, user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      options: {} as never
    })

    expect(sessions.loadMessages).toHaveBeenCalledWith('session')
    expect(mocks.run.mock.calls[0][0]).toEqual([history, user])
  })

  it('resumes the main chain without saving a new message when message is undefined', async () => {
    // 「回主链续跑」：不新增消息，直接用主链历史作为模型输入（末尾是含 schedule_task 结果的
    // assistant，AI SDK 从其之后继续）。用 -1 断言 loadMessages 被调用且不触发 saveSessionMessages。
    const mainAssistant: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main work' }]
    }
    mocks.prepare.mockResolvedValue([user, mainAssistant])
    mocks.run.mockResolvedValue([user, mainAssistant])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [user, mainAssistant]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: undefined,
      options: {} as never
    })

    // 不新增消息（不调用 saveSessionMessages）。
    expect(mocks.save).not.toHaveBeenCalled()
    // 用主链历史作为输入。
    expect(sessions.loadMessages).toHaveBeenCalledWith('session')
    expect(mocks.run.mock.calls[0][0]).toEqual([user, mainAssistant])
    // 不生成标题。
    expect(mocks.title).not.toHaveBeenCalled()
  })

  it('★ 不变式：下传 uiTargetId 时，发给渲染层的 UI 底座末条 id 恒等于它（替换 DB 反推）', async () => {
    // 解 A 的核心：`uiTargetId` 是 UI 身份的唯一权威。有它就不再从 DB 反推（`lastVisibleAssistant`
    // 也不该被调用）——这正是「消除猜 ⇒ 消除副本」。
    const storedRow: UIMessage = {
      id: 'target-id',
      role: 'assistant',
      parts: [{ type: 'text', text: 'carried' }]
    }
    mocks.run.mockResolvedValue([storedRow])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [storedRow]),
      findMessageById: vi.fn(() => storedRow),
      lastAssistant: vi.fn(() => undefined),
      lastVisibleAssistant: vi.fn(() => undefined),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    const result = await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { id: 'answer', role: 'assistant', parts: [] } as UIMessage,
      uiTargetId: 'target-id',
      options: {} as never
    })

    expect(sessions.findMessageById).toHaveBeenCalledWith('session', 'target-id')
    const uiOriginalMessages = mocks.run.mock.calls[0][4] as UIMessage[]
    expect(uiOriginalMessages).toHaveLength(1)
    expect(uiOriginalMessages.at(-1)?.role).toBe('assistant')
    expect(uiOriginalMessages.at(-1)?.id).toBe('target-id')
    // ★ 回报的 uiMessageId 就是它 —— 供本轮的 nest/reset 内部轮复用。
    expect(result?.uiMessageId).toBe('target-id')
    // 有权威 id 时**不再**从 DB 反推 UI 锚点。
    expect(sessions.lastVisibleAssistant).not.toHaveBeenCalled()
  })

  it('★ 不变式：reset 续写轮 ⇒ UI 底座**不带** assistant（末条是 compaction user）、UI id 换 reset 新行', async () => {
    // 根本修复：reset 续写轮**故意不让 uiOriginalMessages 末条是 assistant**（不挂 uiTarget/continuationOf），
    // 并下传 generateMessageId = reset 新行 id ⇒ AI SDK 采用新 id ⇒ 渲染端末端 id 收敛到 start 之后
    // （后续 ask_user 回答天然可被模型读到）。详见 persist.ts 的注释。
    const compactionUser: UIMessage = {
      id: 'compaction',
      role: 'user',
      metadata: { compaction: true },
      parts: [{ type: 'text', text: '# Handoff\nContinue.' }]
    }
    const dbAnchor: UIMessage = {
      id: 'db-anchor',
      role: 'assistant',
      parts: [{ type: 'text', text: 'prior' }]
    }
    mocks.prepare.mockResolvedValue([compactionUser])
    // AI SDK 返回「模型输入 + 合并后的 assistant」——末条 assistant 是产出。
    mocks.run.mockResolvedValue([
      compactionUser,
      { id: 'ui-authority', role: 'assistant', parts: [{ type: 'text', text: 'continued' }] }
    ])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [compactionUser]),
      findMessageById: vi.fn(() => undefined),
      lastAssistant: vi.fn(() => dbAnchor),
      // 兜底：库里也查不到渲染端那条（reset 会把旧行删掉）⇒ 退化为「库内末端 assistant」的 parts，
      // **但 id 恒取 `uiTargetId`**（见 persist 的 `uiOriginalMessages` 构造）。
      lastVisibleAssistant: vi.fn(() => undefined),
      deleteBeforeStart: vi.fn(),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    const result = await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      uiTargetId: 'ui-authority',
      options: {} as never
    })

    const uiOriginalMessages = mocks.run.mock.calls[0][4] as UIMessage[]
    const responseId = mocks.run.mock.calls[0][6] as string | undefined
    // ★ UI 底座**末条不是 assistant**（= 模型输入，末条是 compaction user）⇒ AI SDK 采用新 id。
    expect(uiOriginalMessages.at(-1)?.role).toBe('user')
    expect(uiOriginalMessages.at(-1)?.id).toBe('compaction')
    // ★ 下传的 responseId（= reset 新行 id）非空，且与回报的 uiMessageId 一致。
    expect(typeof responseId).toBe('string')
    expect(result?.uiMessageId).toBe(responseId)
    expect(result?.uiMessageId).not.toBe('ui-authority')
  })

  it('★ 不变式：嵌套轮 + uiTargetId ⇒ 不再调 lastVisibleAssistant 反推（有权威 id 时纯浪费）', async () => {
    // 简化守门：`uiTargetId` 是唯一权威 ⇒ 有它时**不该**再查 `lastVisibleAssistant`（DB 反推）。
    // 该不变式此前只覆盖**非嵌套轮**；本用例补上 `nested: true` 这一真正会走反推的分支。
    const uiTarget: UIMessage = {
      id: 'G',
      role: 'assistant',
      parts: [{ type: 'text', text: 'authority' }]
    }
    const merged: UIMessage = {
      id: 'G',
      role: 'assistant',
      parts: [...uiTarget.parts, { type: 'text', text: 'delta' }]
    }
    mocks.run.mockImplementation(async (_m, _o, _c, onMessage) => {
      onMessage(merged)
      return [merged]
    })
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => []),
      findMessageById: vi.fn(() => uiTarget),
      lastAssistant: vi.fn(() => uiTarget),
      lastVisibleAssistant: vi.fn(() => uiTarget),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { id: 'nest', role: 'user', parts: [{ type: 'text', text: 'nest prompt' }] },
      nested: true,
      uiTargetId: 'G',
      options: {} as never
    })

    // ★ 有权威 id ⇒ 不再从 DB 反推 UI 锚点（否则每次嵌套轮都白查一次）。
    expect(sessions.lastVisibleAssistant).not.toHaveBeenCalled()
    // 且 UI 底座末条 id 恒 = uiTargetId。
    expect((mocks.run.mock.calls[0][4] as UIMessage[]).at(-1)?.id).toBe('G')
  })

  it('★ 不变式：新建嵌套行 + uiTargetId ⇒ 切片基准 = AI SDK 流式基线（uiTarget），而非 DB lastVisibleAssistant', async () => {
    // Red 复现：解 A 给出 uiTargetId 后，AI SDK 的流式基线（uiOriginalMessages.at(-1) = uiTarget）
    // 与落库切片基准（曾用 DB 的 nestedAnchor = lastVisibleAssistant）**不同源**。多轮嵌套链里二者
    // 长度不同（uiTarget = 主链行，nestedAnchor = 上一嵌套行）⇒ 按 nestedAnchor 切会**丢本轮输出**
    // （实测：应存 5 parts，实存 2）。此处令二者长度不同（uiTarget 2 parts / DB 5 parts），断言按前者切。
    const uiTarget: UIMessage = {
      id: 'G',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' }
      ]
    }
    const dbEnd: UIMessage = {
      id: 'G-nested-u1',
      role: 'assistant',
      metadata: { nested: true },
      parts: Array.from({ length: 5 }, (_, i) => ({ type: 'text', text: `n${i}` }))
    }
    // 模型输出 = AI SDK 以 uiTarget(2) 为基线 + 本轮增量 5 ⇒ 共 7 parts。
    const merged: UIMessage = {
      id: 'G',
      role: 'assistant',
      parts: Array.from({ length: 7 }, (_, i) => ({ type: 'text', text: `x${i}` }))
    }
    mocks.run.mockImplementation(async (_m, _o, _c, onMessage) => {
      onMessage(merged)
      return [merged]
    })
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => []),
      findMessageById: vi.fn(() => uiTarget), // uiTarget 2 parts
      lastAssistant: vi.fn(() => uiTarget),
      lastVisibleAssistant: vi.fn(() => dbEnd), // DB 末端 5 parts（≠ uiTarget）
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { id: 'nest', role: 'user', parts: [{ type: 'text', text: 'nest prompt' }] },
      nested: true,
      uiTargetId: 'G',
      options: {} as never
    })

    const stored = sessions.saveMessages.mock.calls.at(-1)?.[1]?.[0] as UIMessage
    // 正确增量 = 7 − 2（按流式基线 uiTarget 切）= 5；若按 DB lastVisibleAssistant(5) 切则得 2（丢 3）。
    expect(stored.parts).toHaveLength(5)
    expect(stored.parts).toEqual(Array.from({ length: 5 }, (_, i) => ({ type: 'text', text: `x${2 + i}` })))
  })

  it('缺省（无 uiTargetId）⇒ 逐字节回退现行为（向后兼容）', async () => {
    // 不传 `uiTargetId`（首轮无末端 / 旧渲染端）⇒ 完全走原路径：嵌套轮用 `lastVisibleAssistant`。
    const anchor: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main' }]
    }
    mocks.run.mockResolvedValue([anchor])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [anchor]),
      lastAssistant: vi.fn(() => anchor),
      lastVisibleAssistant: vi.fn(() => anchor),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { id: 'nest', role: 'user', parts: [{ type: 'text', text: 'nest' }] },
      nested: true,
      options: {} as never
    })

    // 无 uiTargetId ⇒ 仍走 lastVisibleAssistant 反推（现行为原样保留）。
    expect(sessions.lastVisibleAssistant).toHaveBeenCalledWith('session')
    expect(mocks.run.mock.calls[0][4]).toEqual([anchor])
  })

  it('uses the main-chain assistant as the UI anchor for a nested reset continuation', async () => {
    const compactionUser: UIMessage = {
      id: 'compaction',
      role: 'user',
      metadata: { compaction: true, nested: true },
      parts: [{ type: 'text', text: '# Handoff\nContinue.' }]
    }
    const mainAssistant: UIMessage = {
      id: 'main',
      role: 'assistant',
      parts: [{ type: 'text', text: 'main work' }]
    }
    mocks.run.mockResolvedValue([compactionUser])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [history, user]),
      lastAssistant: vi.fn(() => mainAssistant),
      lastVisibleAssistant: vi.fn(() => mainAssistant),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: compactionUser,
      nested: true,
      options: {} as never
    })

    // 子任务的 UI 身份锚定**渲染层末端 assistant**（不过滤 nested），而非 reset 语义的 'before'。
    expect(sessions.lastVisibleAssistant).toHaveBeenCalledWith('session')
    expect(sessions.lastAssistant).not.toHaveBeenCalledWith('session', 'before')
    expect(mocks.run.mock.calls[0][4]).toEqual([mainAssistant])
  })

  it('reset continuation does NOT attach the pre-reset assistant (new response id instead)', async () => {
    // reset 续写：模型输入末尾是 compaction user。**根本修复**：不再把截断前最后一条 assistant
    // 挂到 uiOriginalMessages 末尾（那样会强制复用旧 id ⇒ 旧行在 start 之前 ⇒ 回答读不到）；
    // 改为让末条不是 assistant + 下传 generateMessageId = reset 新行 id ⇒ 渲染端收敛到 start 之后。
    const compactionUser: UIMessage = {
      id: 'compaction',
      role: 'user',
      metadata: { compaction: true },
      parts: [{ type: 'text', text: '# Handoff\nContinue.' }]
    }
    const earlierAssistant: UIMessage = {
      id: 'earlier',
      role: 'assistant',
      parts: [{ type: 'text', text: 'prior' }]
    }
    mocks.prepare.mockResolvedValue([compactionUser])
    mocks.run.mockResolvedValue([compactionUser])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [compactionUser]),
      lastAssistant: vi.fn(() => earlierAssistant),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      options: {} as never
    })

    expect(sessions.lastAssistant).toHaveBeenCalledWith('session', 'before')
    expect(mocks.run).toHaveBeenCalledTimes(1)
    // 第 5 参 uiOriginalMessages **只有模型输入**（末条是 compaction user，不带 assistant 底座）。
    expect(mocks.run.mock.calls[0][4]).toEqual([compactionUser])
    // 第 7 参 responseId = reset 新行 id（非空）。
    expect(typeof mocks.run.mock.calls[0][6]).toBe('string')
  })

  it('★ 不变式：reset 续写轮保留 reset 前那段的处理时长（baseProcessingMs 不归零）', async () => {
    // 根本修复把 `continuationOf` 从 `uiOriginalMessages` 里拿掉后，`session.ts` 无法再从
    // `uiOriginalMessages` 读到 reset 前那段的 `totalProcessingMs` ⇒ 时长会在 reset 边界归零
    // （实测：reset 前累计 5000ms，reset 后续写轮得 0）。故须把该时长作为 `baseProcessingMs`
    // 显式下传，使渲染端「处理时长」跨 reset 连续。
    const compactionUser: UIMessage = {
      id: 'compaction',
      role: 'user',
      metadata: { compaction: true },
      parts: [{ type: 'text', text: '# Handoff\nContinue.' }]
    }
    const earlierAssistant: UIMessage = {
      id: 'earlier',
      role: 'assistant',
      metadata: { totalProcessingMs: 5000 },
      parts: [{ type: 'text', text: 'prior' }]
    }
    mocks.prepare.mockResolvedValue([compactionUser])
    mocks.run.mockResolvedValue([compactionUser])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [compactionUser]),
      lastAssistant: vi.fn(() => earlierAssistant),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      options: {} as never
    })

    // 第 6 参 baseProcessingMs = reset 前那条 assistant 的累计时长。
    expect(mocks.run.mock.calls[0][5]).toBe(5000)
  })

  it('does not return an assistant message from an earlier run', async () => {
    mocks.run.mockResolvedValue([history, user])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [history, user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await expect(
      runStoredAgentSession(sessions as never, {
        sessionId: 'session',
        cwd: 'cwd',
        message: user,
        options: {} as never
      })
    ).resolves.toBeUndefined()
    expect(sessions.saveMessages).not.toHaveBeenCalled()
  })

  it('does not save an incomplete response when streaming fails', async () => {
    mocks.run.mockRejectedValue(new Error('stream failed'))

    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
    await expect(
      runStoredAgentSession(sessions as never, {
        sessionId: 'session',
        cwd: 'cwd',
        message: user,
        options: {} as never
      })
    ).rejects.toThrow('stream failed')

    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.save).toHaveBeenCalledWith(sessions, 'session', 'cwd', [user], undefined)
    expect(sessions.saveMessages).not.toHaveBeenCalled()
  })

  it('preserves the workflowPrefix marker on the user input when plan mode is on', async () => {
    // 计划模式开启：渲染层在用户消息上带 `metadata.workflowPrefix: true` ⇒ 落库保留该标记
    // （text 不变），由 `toModelMessages` 在送模型时拼前缀。
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: userWithWorkflow,
      options: {} as never
    })

    expect(mocks.save).toHaveBeenCalledWith(
      sessions,
      'session',
      'cwd',
      [userWithWorkflow],
      undefined
    )
  })

  it('generates a title for the first non-trivial user message', async () => {
    mocks.run.mockResolvedValue([user])
    const onTitle = vi.fn()
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { ...user, parts: [{ type: 'text', text: 'explain this issue' }] },
      onTitle,
      options: {} as never
    })
    await vi.waitFor(() =>
      expect(sessions.renameSession).toHaveBeenCalledWith('session', 'Greeting')
    )
    expect(mocks.title).toHaveBeenCalledWith('explain this issue', undefined)
    expect(onTitle).toHaveBeenCalledWith('Greeting')
  })

  it('forwards the model config (own api key) to title generation', async () => {
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { ...user, parts: [{ type: 'text', text: 'explain this issue' }] },
      modelConfig: { modelId: 'deepseek-v4-pro', reasoningEffort: 'off', apiKey: 'sk-own' },
      options: {} as never
    })
    await vi.waitFor(() =>
      expect(sessions.renameSession).toHaveBeenCalledWith('session', 'Greeting')
    )
    expect(mocks.title).toHaveBeenCalledWith('explain this issue', {
      modelId: 'deepseek-v4-pro',
      reasoningEffort: 'off',
      apiKey: 'sk-own'
    })
  })

  it('finishes only after the generated title is persisted', async () => {
    const title = Promise.withResolvers<string>()
    mocks.title.mockReturnValue(title.promise)
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
    const running = runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: { ...user, parts: [{ type: 'text', text: 'explain this issue' }] },
      options: {} as never
    })

    let finished = false
    void running.then(() => {
      finished = true
    })
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
    expect(finished).toBe(false)

    title.resolve('Generated title')
    await running
    expect(sessions.renameSession).toHaveBeenCalledWith('session', 'Generated title')
  })

  it('skips title generation for short messages', async () => {
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'session',
      cwd: 'cwd',
      message: user,
      options: {} as never
    })

    expect(mocks.title).not.toHaveBeenCalled()
    expect(sessions.renameSession).not.toHaveBeenCalled()
  })

  it('skips title generation for an existing session or an explicit title', async () => {
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => true),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
    const message = { ...user, parts: [{ type: 'text' as const, text: 'explain this issue' }] }

    await runStoredAgentSession(sessions as never, {
      sessionId: 'existing',
      cwd: 'cwd',
      message,
      options: {} as never
    })
    sessions.hasSession.mockReturnValue(false)
    await runStoredAgentSession(sessions as never, {
      sessionId: 'named',
      cwd: 'cwd',
      message,
      title: 'Named task',
      options: {} as never
    })

    expect(mocks.title).not.toHaveBeenCalled()
    expect(sessions.renameSession).not.toHaveBeenCalled()
  })

  it('keeps the derived title when title generation fails or returns empty text', async () => {
    mocks.run.mockResolvedValue([user])
    const sessions = {
      hasSession: vi.fn(() => false),
      loadMessages: vi.fn(() => [user]),
      renameSession: vi.fn(),
      saveMessages: vi.fn()
    }
    const message = { ...user, parts: [{ type: 'text' as const, text: 'explain this issue' }] }

    mocks.title.mockRejectedValueOnce(new Error('title failed')).mockResolvedValueOnce('')
    await runStoredAgentSession(sessions as never, {
      sessionId: 'failed',
      cwd: 'cwd',
      message,
      options: {} as never
    })
    await runStoredAgentSession(sessions as never, {
      sessionId: 'empty',
      cwd: 'cwd',
      message,
      options: {} as never
    })
    await vi.waitFor(() => expect(mocks.title).toHaveBeenCalledTimes(2))

    expect(sessions.renameSession).not.toHaveBeenCalled()
  })
})
