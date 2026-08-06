import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionStore } from '../../../../src/main/core/session'
import { saveSessionMessages } from '../../../../src/main/core/session/save'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function createStore(): Promise<SessionStore> {
  const directory = await mkdtemp(join(tmpdir(), 'larify-sessions-'))
  directories.push(directory)
  return new SessionStore(join(directory, 'sessions.db'))
}

const message = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }]
})

const compaction = (id: string, query: string, summary: string): UIMessage => ({
  id,
  role: 'user',
  metadata: { compaction: true },
  parts: [{ type: 'text', text: `${query}\n\n${summary}` }]
})

const save = (
  store: SessionStore,
  id: string,
  messages: UIMessage[],
  cwd: string,
  title: string,
  tasks?: string[]
): void => store.saveSession({ id, title, cwd, tasks, messages })

describe('SessionStore', () => {
  it('uses a custom title when saving messages', async () => {
    const store = await createStore()
    saveSessionMessages(store, 'chat', '/cwd', [message('one', 'derived')], 'Custom title')
    expect(store.loadSession('chat')?.title).toBe('Custom title')
    store.close()
  })

  it('returns null for a missing session', async () => {
    const store = await createStore()
    expect(await store.loadSession('missing')).toBeNull()
    store.close()
  })

  it('saves and loads messages', async () => {
    const store = await createStore()
    const messages = [message('one', 'hello'), message('two', 'world')]
    await save(store, 'chat/one', messages, '/workspace', 'hello')

    expect(await store.loadSession('chat/one')).toMatchObject({
      id: 'chat/one',
      messages,
      cwd: '/workspace'
    })
    expect(await store.loadSession('chat/one')).toMatchObject({
      id: 'chat/one',
      title: 'hello',
      cwd: '/workspace'
    })
    store.close()
  })

  it('appends messages while preserving metadata and task links', async () => {
    const store = await createStore()
    await save(store, 'chat', [message('one', 'first')], '/one', 'first', ['/a.md'])
    const first = await store.loadSession('chat')
    await save(store, 'chat', [message('two', 'second')], '/two', 'first', ['/a.md', '/b.md'])
    const second = await store.loadSession('chat')

    expect(await store.loadSession('chat')).toMatchObject({
      messages: [message('one', 'first'), message('two', 'second')],
      cwd: '/two'
    })
    expect(second?.createdAt).toBe(first?.createdAt)
    expect(second?.title).toBe('first')
    expect(second?.tasks).toEqual(['/a.md', '/b.md'])
    store.close()
  })

  it('updates existing messages without removing omitted history', async () => {
    const store = await createStore()
    await save(
      store,
      'chat',
      [message('one', 'one'), message('two', 'two'), message('three', 'three')],
      '/cwd',
      'chat'
    )

    await save(store, 'chat', [message('one', 'one'), message('two', 'changed')], '/cwd', 'chat')

    expect(await store.loadSession('chat')).toMatchObject({
      messages: [message('one', 'one'), message('two', 'changed'), message('three', 'three')],
      cwd: '/cwd'
    })
    store.close()
  })

  it('preserves messages when no new messages are provided', async () => {
    const store = await createStore()
    const messages = [message('one', 'one')]
    await save(store, 'chat', messages, '/cwd', 'chat')

    store.saveSession({ id: 'chat', title: 'renamed', cwd: '/cwd' })
    expect(store.loadSession('chat')).toMatchObject({ title: 'renamed', messages })

    store.saveSession({ id: 'chat', title: 'renamed', cwd: '/cwd', messages: [] })
    expect(store.loadSession('chat')).toMatchObject({ messages })
    store.close()
  })

  it('loads model messages from the latest compaction', async () => {
    const store = await createStore()
    save(store, 'chat', [message('one', 'old')], '/cwd', 'chat')
    store.saveStart('chat', compaction('compact', 'current query', 'previous summary'))
    save(store, 'chat', [message('two', 'new')], '/cwd', 'chat')

    expect(store.loadSession('chat')).toMatchObject({
      start: expect.any(Number),
      messages: [message('one', 'old'), message('two', 'new')]
    })
    expect(store.loadMessages('chat')).toMatchObject([
      {
        role: 'user',
        metadata: { compaction: true },
        parts: [{ type: 'text', text: 'current query\n\nprevious summary' }]
      },
      message('two', 'new')
    ])
    store.close()
  })

  it('uses only the latest compaction for model messages', async () => {
    const store = await createStore()
    save(store, 'chat', [message('one', 'old')], '/cwd', 'chat')
    store.saveStart('chat', compaction('first', 'first query', 'first summary'))
    save(store, 'chat', [message('two', 'middle')], '/cwd', 'chat')
    store.saveStart('chat', compaction('latest', 'latest query', 'latest summary'))
    save(store, 'chat', [message('three', 'new')], '/cwd', 'chat')

    expect(store.loadSession('chat')?.messages).toEqual([
      message('one', 'old'),
      message('two', 'middle'),
      message('three', 'new')
    ])
    expect(store.loadMessages('chat')).toMatchObject([
      {
        metadata: { compaction: true },
        parts: [{ type: 'text', text: 'latest query\n\nlatest summary' }]
      },
      message('three', 'new')
    ])
    store.close()
  })

  it('paginates visible messages without compaction messages', async () => {
    const store = await createStore()
    save(store, 'chat', [message('one', 'one')], '/cwd', 'chat')
    store.saveStart('chat', compaction('compact', 'query', 'summary'))
    save(store, 'chat', [message('two', 'two'), message('three', 'three')], '/cwd', 'chat')

    expect(store.loadSession('chat', 0, 2)?.messages).toEqual([
      message('two', 'two'),
      message('three', 'three')
    ])
    expect(store.loadSession('chat', 2, 2)?.messages).toEqual([message('one', 'one')])
    store.close()
  })

  it('lists sessions by recent activity', async () => {
    const store = await createStore()
    await save(store, 'first', [message('one', 'first')], '/workspace', 'first')
    await new Promise((resolve) => setTimeout(resolve, 2))
    await save(store, 'second', [message('two', 'second')], '/workspace', 'second')

    expect(await store.listSessions('/workspace')).toMatchObject([
      { id: 'second', cwd: '/workspace' },
      { id: 'first', cwd: '/workspace' }
    ])
    store.close()
  })

  it('lists sessions by page', async () => {
    const store = await createStore()
    await save(store, 'first', [], '/workspace', 'first')
    await new Promise((resolve) => setTimeout(resolve, 2))
    await save(store, 'second', [], '/workspace', 'second')

    expect(await store.listSessions('/workspace', 1, 1)).toMatchObject([{ id: 'first' }])
    store.close()
  })

  it('lists workspaces by recent activity', async () => {
    const store = await createStore()
    await save(store, 'first', [], '/first', 'first')
    await new Promise((resolve) => setTimeout(resolve, 2))
    await save(store, 'second', [], '/second', 'second')

    expect(await store.listCwds()).toEqual(['/second', '/first'])
    store.close()
  })

  it('rolls back a failed save', async () => {
    const store = await createStore()
    await save(store, 'chat', [message('one', 'valid')], '/cwd', 'chat')
    const invalid = [{ ...message('two', 'invalid'), parts: [1n] }] as unknown as UIMessage[]

    expect(() => save(store, 'chat', invalid, '/changed', 'chat')).toThrow()
    expect(await store.loadSession('chat')).toMatchObject({
      messages: [message('one', 'valid')],
      cwd: '/cwd'
    })
    store.close()
  })

  it('rolls back a failed start update', async () => {
    const store = await createStore()
    save(store, 'chat', [message('one', 'old')], '/cwd', 'chat')
    store.saveStart('chat', compaction('old-start', 'query', 'summary'))
    save(store, 'chat', [message('two', 'new')], '/cwd', 'chat')

    const invalid = { ...message('bad-start', 'invalid'), parts: [1n] } as unknown as UIMessage
    expect(() => store.saveStart('chat', invalid)).toThrow()
    expect(store.loadMessages('chat')).toMatchObject([
      {
        id: 'old-start',
        metadata: { compaction: true }
      },
      message('two', 'new')
    ])
    store.close()
  })
})
