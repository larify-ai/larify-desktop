import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterAll, describe, expect, it } from 'vitest'
import { SessionStore } from '../../../../src/main/core/session'

const workspace = mkdtempSync(join(tmpdir(), 'find-ask-user-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

function newStore(name: string): SessionStore {
  const path = join(workspace, `${name}.db`)
  rmSync(path, { force: true })
  const store = new SessionStore(path)
  store.createSession({ cwd: '/w', id: 's', title: 'T' })
  return store
}

const assistant = (
  id: string,
  ask: Array<{ toolCallId: string; state: string; type?: string }>
): UIMessage =>
  ({
    id,
    role: 'assistant',
    metadata: { nested: true },
    parts: [
      { type: 'step-start' },
      ...ask.map((a) => ({
        type: a.type ?? 'tool-agent_ask_user',
        toolCallId: a.toolCallId,
        state: a.state,
        input: {}
      }))
    ]
  }) as unknown as UIMessage

describe('SessionStore.findMessageByAskUserCallId', () => {
  it('命中「该 toolCallId 且 state=input-available」的 assistant 行', () => {
    const store = newStore('hit')
    store.saveMessages('s', [assistant('a1', [{ toolCallId: 'c1', state: 'input-available' }])])
    const found = store.findMessageByAskUserCallId('s', 'c1')
    expect(found?.id).toBe('a1')
    store.dispose()
  })

  it('已答（output-available）的 ask_user 不再命中（避免命中历史旧回答）', () => {
    const store = newStore('answered')
    store.saveMessages('s', [
      assistant('a1', [
        { toolCallId: 'old', state: 'output-available' },
        { toolCallId: 'now', state: 'input-available' }
      ])
    ])
    expect(store.findMessageByAskUserCallId('s', 'old')).toBeUndefined()
    expect(store.findMessageByAskUserCallId('s', 'now')?.id).toBe('a1')
    store.dispose()
  })

  it('同一 assistant 内既含旧的已答、又含当前待答：只认待答的那个', () => {
    const store = newStore('mixed')
    store.saveMessages('s', [
      assistant('a1', [
        { toolCallId: 'k1', state: 'output-available' },
        { toolCallId: 'k2', state: 'output-error' },
        { toolCallId: 'k3', state: 'input-available' }
      ])
    ])
    expect(store.findMessageByAskUserCallId('s', 'k1')).toBeUndefined()
    expect(store.findMessageByAskUserCallId('s', 'k2')).toBeUndefined()
    expect(store.findMessageByAskUserCallId('s', 'k3')?.id).toBe('a1')
    store.dispose()
  })

  it('user 行（如 compaction handoff 拼进了 parts）不算承载者', () => {
    const store = newStore('user-row')
    store.saveMessages('s', [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: '# Handoff' },
          { type: 'tool-agent_ask_user', toolCallId: 'c1', state: 'input-available', input: {} }
        ]
      } as unknown as UIMessage
    ])
    expect(store.findMessageByAskUserCallId('s', 'c1')).toBeUndefined()
    store.dispose()
  })

  it('不受 sessions.start 游标影响（等待态可能在游标之前）', () => {
    const store = newStore('cursor')
    store.saveMessages('s', [
      { id: 'u0', role: 'user', parts: [{ type: 'text', text: 'q' }] } as UIMessage,
      assistant('a1', [{ toolCallId: 'c1', state: 'input-available' }])
    ])
    store.saveStart('s', { id: 'later', role: 'user', parts: [{ type: 'text', text: 'x' }] } as UIMessage)
    expect(store.loadMessages('s').some((m) => m.id === 'a1')).toBe(false)
    expect(store.findMessageByAskUserCallId('s', 'c1')?.id).toBe('a1')
    store.dispose()
  })

  it('不存在时返回 undefined', () => {
    const store = newStore('missing')
    store.saveMessages('s', [assistant('a1', [{ toolCallId: 'c1', state: 'input-available' }])])
    expect(store.findMessageByAskUserCallId('s', 'nope')).toBeUndefined()
    store.dispose()
  })
})
