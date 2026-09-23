import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { SessionStore } from '../../../../src/main/core/session/store'

const stores: SessionStore[] = []
const dirs: string[] = []

function createStore(): SessionStore {
  const dir = mkdtempSync(join(tmpdir(), 'larify-store-'))
  dirs.push(dir)
  const store = new SessionStore(join(dir, 'sessions.db'))
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function user(id: string, text: string, nested = false): UIMessage {
  return {
    id,
    role: 'user',
    metadata: nested ? { nested: true } : undefined,
    parts: [{ type: 'text', text }]
  }
}

describe('SessionStore nested filtering', () => {
  it('hides nested messages from the model input but keeps them visible', () => {
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    store.saveMessages('session', [user('a', 'root'), user('b', 'child', true)])

    expect(store.loadMessages('session').map((m) => m.id)).toEqual(['a'])
    expect(store.loadVisibleMessages('session').map((m) => m.id)).toEqual(['a', 'b'])
    expect(store.countMessages('session')).toBe(2)
  })

  it('ignores nested messages when finding the assistant before the start cursor', () => {
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    const nestedAssistant: UIMessage = {
      id: 'nested',
      role: 'assistant',
      metadata: { nested: true },
      parts: [{ type: 'text', text: 'child' }]
    }
    const outerAssistant: UIMessage = {
      id: 'outer',
      role: 'assistant',
      parts: [{ type: 'text', text: 'root' }]
    }
    store.saveMessages('session', [outerAssistant, nestedAssistant])
    store.saveStart('session', user('cursor', 'reset'))

    expect(store.lastAssistant('session', 'before')?.id).toBe('outer')
  })

  it('returns the latest main-chain assistant for the after cursor, skipping nested messages', () => {
    // 递归子任务轮次用它作 UI 流式消息的身份锚点：取主链段最后一条 assistant，且跳过 nested。
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    const assistant = (id: string, nested = false): UIMessage => ({
      id,
      role: 'assistant',
      metadata: nested ? { nested: true } : undefined,
      parts: [{ type: 'text', text: id }]
    })
    store.saveMessages('session', [
      user('u1', 'q'),
      assistant('main'),
      user('nest', 'nest prompt', true),
      assistant('child-assistant', true)
    ])

    expect(store.lastAssistant('session', 'after')?.id).toBe('main')
  })

  it('returns the renderer-visible last assistant, including nested rows (UI anchor)', () => {
    // nest 轮的 UI 身份锚点必须等于**渲染层此刻的末端 assistant**（渲染层把嵌套行也当普通
    // assistant 持有）。与 lastAssistant('after')（过滤 nested ⇒ 恒返主链行）不同：
    // 这里**不过滤 nested** ⇒ 「上一轮是嵌套轮」时返回那条 nested 行，锚点才不会错位。
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    const assistant = (id: string, nested = false): UIMessage => ({
      id,
      role: 'assistant',
      metadata: nested ? { nested: true } : undefined,
      parts: [{ type: 'text', text: id }]
    })
    store.saveMessages('session', [
      user('u1', 'q'),
      assistant('main'),
      user('nest-1', 'nest prompt', true),
      assistant('main-nested-aaaa', true)
    ])

    // 主链查询（过滤 nested）返回主链行。
    expect(store.lastAssistant('session', 'after')?.id).toBe('main')
    // UI 锚点（不过滤 nested）返回渲染层末端 —— 上一轮的嵌套行。
    expect(store.lastVisibleAssistant('session')?.id).toBe('main-nested-aaaa')

    // 再追加一轮嵌套后，锚点随之推进到最新一条（这正是「第二个嵌套轮起」不再重复的关键）。
    store.saveMessages('session', [
      user('nest-2', 'nest prompt 2', true),
      assistant('main-nested-bbbb', true)
    ])
    expect(store.lastVisibleAssistant('session')?.id).toBe('main-nested-bbbb')
  })

  it('keeps the main chain loadable after a child (nested) reset moves the start cursor', () => {
    // 回归：`sessions.start` 是主链上下文游标。若子任务（nested）的 reset 也用 saveStart 把游标
    // 推到子任务位置，之后 loadMessages（position >= start）就只剩子任务之后的残片——主链上下文
    // 被清空。这里固化「游标一旦被推后，主链即丢失」这一事实，作为 worker 侧必须对 nested 跳过
    // saveStart 的依据。
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    store.saveMessages('session', [user('u1', 'question'), user('a1', 'answer')])
    const before = store.loadMessages('session').map((m) => m.id)
    expect(before).toEqual(['u1', 'a1'])

    store.saveMessages('session', [user('n1', 'nest prompt', true)])
    store.saveStart('session', user('n2', 'handoff', true))
    store.saveMessages('session', [user('na', 'child work', true)])

    // 游标被推到 n2 之后：主链历史（u1/a1）不再出现在模型输入里（仅 nested 过滤后为空）。
    expect(store.loadMessages('session')).toEqual([])
  })

  it('is a dumb store: it writes exactly what it is given (no silent rewriting)', () => {
    // `saveMessages` 是**哑存储**：不按 id 形状推断/补写任何元数据。
    // 背景：曾试过在写入关口「id 带 -nested- ⇒ 补 nested:true」的全局兜底，但它会**静默改写**
    // 真实数据里「主链 assistant 行却带 -nested- 后缀」的行（全库实测 10 条，含 `e2212cc1#6843`、
    // `31b06fa6#6518`）——把主链行翻成嵌套行 ⇒ 从模型输入消失。故该不变量的**唯一来源**改为
    // `persist.ts` 的 `appendToRow`（它同时决定 id 与 nested 标记，见 persist 的单测）。
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })

    // 带后缀但**无** nested 标记的 assistant 行：原样落库、原样读回（不补、不改）。
    store.saveMessages('session', [
      {
        id: 'main-nested-aaaa',
        role: 'assistant',
        metadata: { totalProcessingMs: 1 },
        parts: [{ type: 'text', text: 'main-chain reply' }]
      } as UIMessage
    ])
    const row = store.loadVisibleMessages('session').find((m) => m.id === 'main-nested-aaaa')
    expect(row?.metadata).toEqual({ totalProcessingMs: 1 })
    // 因为没被补 nested，它仍是**主链行**：在模型输入里、也作为 id 基返回。
    expect(store.loadMessages('session').map((m) => m.id)).toEqual(['main-nested-aaaa'])
    expect(store.lastAssistant('session', 'after')?.id).toBe('main-nested-aaaa')
  })

  it('deletes a row before the start cursor and leaves the cursor untouched', () => {
    // reset 续写用新行取代旧行：旧行恒在 `start` 之前（由 lastAssistant('before') 查出）。
    // 删除它不得移动 `start`，也不得影响可见/模型输入之外的任何行。
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    store.saveMessages('session', [user('u1', 'q'), user('a1', 'old answer')])
    store.saveStart('session', user('cursor', 'reset'))
    const startBefore = store.startPosition('session')

    store.deleteBeforeStart('session', 'a1')

    expect(store.loadVisibleMessages('session').map((m) => m.id)).toEqual(['u1'])
    expect(store.startPosition('session')).toBe(startBefore)
    // 幂等：再删一次不抛。
    expect(() => store.deleteBeforeStart('session', 'a1')).not.toThrow()
  })

  it('refuses to delete the boundary row or a row after it (fail-fast, no silent cursor reset)', () => {
    // 边界不变式：`continuationOf` 只可能来自 `'before'` 查询（position < start）。若调用方拿边界行
    // 或边界之后的行来删，是编程错误 —— 必须显式失败，而不是静默清空 `start`（旧实现的「防御」）。
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    store.saveMessages('session', [user('u1', 'q')])
    store.saveStart('session', user('cursor', 'reset'))
    store.saveMessages('session', [user('after', 'post-reset')])

    expect(() => store.deleteBeforeStart('session', 'cursor')).toThrow(/压缩边界之前/)
    expect(() => store.deleteBeforeStart('session', 'after')).toThrow(/压缩边界之前/)
    // `start` 未被这些失败调用改动。
    expect(store.startPosition('session')).not.toBe(-1)
    expect(store.loadVisibleMessages('session').map((m) => m.id)).toEqual(['u1', 'after'])
  })

  it('excludes recursive child messages from the navigation index', () => {
    const store = createStore()
    store.createSession({ id: 'session', title: 't', cwd: 'cwd' })
    const assistant = (id: string, text: string, nested = false): UIMessage => ({
      id,
      role: 'assistant',
      metadata: nested ? { nested: true } : undefined,
      parts: [{ type: 'text', text }]
    })
    store.saveMessages('session', [
      user('u1', '深度调研'),
      assistant('a1', '根任务回复'),
      user('u2', '内部 nest prompt', true),
      assistant('a2', '子任务过程', true)
    ])

    const items = store.loadNavigationIndex('session')

    expect(items.map((item) => item.id)).toEqual(['u1'])
    expect(items[0].responsePreview).toBe('根任务回复')
  })
})
