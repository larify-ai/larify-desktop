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
