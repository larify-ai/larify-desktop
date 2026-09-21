import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, describe, expect, it } from 'vitest'
import { SessionStore } from '../../../../src/main/core/session'

const workspace = mkdtempSync(join(tmpdir(), 'ask-user-ctx-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

function newStore(name: string): SessionStore {
  const path = join(workspace, `${name}.db`)
  rmSync(path, { force: true })
  const store = new SessionStore(path)
  store.createSession({ cwd: '/w', id: 's', title: 'T' })
  return store
}

const nestPrompt = (text = 'To complete the current task `sub/task.md`'): UIMessage =>
  ({
    id: 'nest-prompt',
    role: 'user',
    metadata: { nested: true, compaction: true },
    parts: [{ type: 'text', text }]
  }) as unknown as UIMessage

const nestedAssistantWithAsk = (toolCallId: string, state = 'input-available'): UIMessage =>
  ({
    id: 'a-nested',
    role: 'assistant',
    metadata: { nested: true },
    parts: [
      { type: 'step-start' },
      { type: 'tool-agent_ask_user', toolCallId, state, input: {} }
    ]
  }) as unknown as UIMessage

const mainAssistantWithAsk = (toolCallId: string, state = 'input-available'): UIMessage =>
  ({
    id: 'a-main',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      { type: 'tool-agent_ask_user', toolCallId, state, input: {} }
    ]
  }) as unknown as UIMessage

describe('SessionStore.findAskUserContext', () => {
  it('子任务轮：返回 owner 且**顺带取回 nest 判据**（owner 的前一条）', () => {
    const store = newStore('nested')
    store.saveMessages('s', [nestPrompt(), nestedAssistantWithAsk('c1')])
    const ctx = store.findAskUserContext('s', 'c1')
    expect(ctx?.owner.id).toBe('a-nested')
    expect(ctx?.prompt?.id).toBe('nest-prompt')
    expect(ctx?.prompt?.metadata?.nested).toBe(true)
    store.dispose()
  })

  it('主链轮：返回 owner，且 **prompt 为空**（前一条不是 nest 判据）', () => {
    const store = newStore('main')
    store.saveMessages('s', [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'q' }] } as UIMessage,
      mainAssistantWithAsk('c2')
    ])
    const ctx = store.findAskUserContext('s', 'c2')
    expect(ctx?.owner.id).toBe('a-main')
    expect(ctx?.prompt).toBeUndefined()
    store.dispose()
  })

  it('已答的 ask_user（state=output-available）不命中', () => {
    const store = newStore('answered')
    store.saveMessages('s', [nestPrompt(), nestedAssistantWithAsk('c3', 'output-available')])
    expect(store.findAskUserContext('s', 'c3')).toBeUndefined()
    store.dispose()
  })

  it('同一 assistant 内多个 ask_user：只命中的 state=input-available 那个可查（历史已答查不到）', () => {
    const store = newStore('multi')
    store.saveMessages('s', [
      nestPrompt('P1'),
      {
        id: 'a-multi',
        role: 'assistant',
        metadata: { nested: true },
        parts: [
          { type: 'step-start' },
          { type: 'tool-agent_ask_user', toolCallId: 'old', state: 'output-available', input: {} },
          { type: 'tool-agent_ask_user', toolCallId: 'now', state: 'input-available', input: {} }
        ]
      } as unknown as UIMessage
    ])
    expect(store.findAskUserContext('s', 'old')).toBeUndefined() // 历史已答 → 查不到
    const ctx = store.findAskUserContext('s', 'now')
    expect(ctx?.owner.id).toBe('a-multi')
    expect(ctx?.prompt?.id).toBe('nest-prompt')
    store.dispose()
  })

  it('不存在时返回 undefined', () => {
    const store = newStore('missing')
    store.saveMessages('s', [nestPrompt(), nestedAssistantWithAsk('c4')])
    expect(store.findAskUserContext('s', 'nope')).toBeUndefined()
    store.dispose()
  })

  it('嵌套轮但其前一条不是判据（异常数据）→ owner 命中、prompt 为空（兜底，不抛错）', () => {
    const store = newStore('anomaly')
    store.saveMessages('s', [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'q' }] } as UIMessage,
      nestedAssistantWithAsk('c5')
    ])
    const ctx = store.findAskUserContext('s', 'c5')
    expect(ctx?.owner.id).toBe('a-nested')
    expect(ctx?.prompt).toBeUndefined()
    store.dispose()
  })
})
