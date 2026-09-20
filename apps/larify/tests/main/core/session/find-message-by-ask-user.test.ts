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

const assistantWithAskUser = (id: string, toolCallId: string): UIMessage =>
  ({
    id,
    role: 'assistant',
    metadata: { nested: true },
    parts: [
      { type: 'step-start' },
      { type: 'text', text: 'hi' },
      { type: 'tool-agent_ask_user', toolCallId, state: 'input-available', input: {} }
    ]
  }) as UIMessage

describe('SessionStore.findMessageByAskUserCallId', () => {
  it('按 toolCallId 定位承载该 ask_user 的消息（含 nested）', () => {
    const store = newStore('locate')
    store.saveMessages('s', [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'q' }] } as UIMessage,
      assistantWithAskUser('a1', 'call-1'),
      assistantWithAskUser('a2', 'call-2')
    ])
    const found = store.findMessageByAskUserCallId('s', 'call-2')
    expect(found?.id).toBe('a2')
    expect(found?.metadata?.nested).toBe(true)
    store.dispose()
  })

  it('不存在时返回 undefined', () => {
    const store = newStore('missing')
    store.saveMessages('s', [assistantWithAskUser('a1', 'call-1')])
    expect(store.findMessageByAskUserCallId('s', 'nope')).toBeUndefined()
    store.dispose()
  })

  it('不受 sessions.start 游标影响（等待态可能在游标之前）', () => {
    const store = newStore('cursor')
    const anchor = assistantWithAskUser('a1', 'call-1')
    store.saveMessages('s', [{ id: 'u0', role: 'user', parts: [{ type: 'text', text: 'q' }] } as UIMessage, anchor])
    // 把 start 游标推到 anchor 之后（模拟 reset_context 截断）
    store.saveStart('s', { id: 'later', role: 'user', parts: [{ type: 'text', text: 'x' }] } as UIMessage)
    // loadMessages 会因 start 过滤掉 anchor，但本查询仍应能找到它
    expect(store.loadMessages('s').some((m) => m.id === 'a1')).toBe(false)
    expect(store.findMessageByAskUserCallId('s', 'call-1')?.id).toBe('a1')
    store.dispose()
  })
})
