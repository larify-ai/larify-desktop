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
  title: string
): void => {
  store.createSession({ id, title, cwd })
  store.saveMessages(id, messages)
}

describe('SessionStore', () => {
  it('uses the Chinese fallback title for a message without text', async () => {
    const store = await createStore()
    const attachment: UIMessage = {
      id: 'attachment',
      role: 'user',
      parts: [{ type: 'file', filename: 'image.png', mediaType: 'image/png', url: 'path' }]
    }
    saveSessionMessages(store, 'chat', '/cwd', [attachment])
    expect(store.listSessions('/cwd')[0]?.title).toBe('未命名任务')
    store.dispose()
  })

  it('uses a custom title when saving messages', async () => {
    const store = await createStore()
    saveSessionMessages(store, 'chat', '/cwd', [message('one', 'derived')], 'Custom title')
    expect(store.listSessions('/cwd')[0]?.title).toBe('Custom title')
    store.dispose()
  })

  it('returns null for a missing session', async () => {
    const store = await createStore()
    expect(store.loadVisibleMessages('missing')).toEqual([])
    expect(store.countMessages('missing')).toBe(0)
    store.dispose()
  })

  it('saves and loads messages', async () => {
    const store = await createStore()
    const messages = [message('one', 'hello'), message('two', 'world')]
    await save(store, 'chat/one', messages, '/workspace', 'hello')

    expect(store.listSessions('/workspace')[0]).toMatchObject({
      id: 'chat/one',
      cwd: '/workspace'
    })
    expect(store.loadVisibleMessages('chat/one')).toEqual(messages)
    store.dispose()
  })

  it('persists sessions after reopening the database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'larify-sessions-'))
    directories.push(directory)
    const path = join(directory, 'sessions.db')
    const first = new SessionStore(path)
    save(first, 'chat', [message('one', 'hello')], '/workspace', 'hello')
    first.dispose()

    const reopened = new SessionStore(path)
    expect(reopened.listSessions('/workspace')[0]).toMatchObject({
      title: 'hello',
      cwd: '/workspace'
    })
    expect(reopened.loadVisibleMessages('chat')).toEqual([message('one', 'hello')])
    reopened.dispose()
  })

  it('appends messages while preserving metadata', async () => {
    const store = await createStore()
    await save(store, 'chat', [message('one', 'first')], '/one', 'first')
    const first = store.listSessions('/one')[0]
    await save(store, 'chat', [message('two', 'second')], '/two', 'second')
    const second = store.listSessions('/one')[0]

    expect(store.loadVisibleMessages('chat')).toEqual([
      message('one', 'first'),
      message('two', 'second')
    ])
    expect(second?.createdAt).toBe(first?.createdAt)
    expect(second?.title).toBe('first')
    store.dispose()
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

    expect(store.loadVisibleMessages('chat')).toEqual([
      message('one', 'one'),
      message('two', 'changed'),
      message('three', 'three')
    ])
    store.dispose()
  })

  it('preserves messages when no new messages are provided', async () => {
    const store = await createStore()
    const messages = [message('one', 'one')]
    await save(store, 'chat', messages, '/cwd', 'chat')

    store.renameSession('chat', 'renamed')
    expect(store.listSessions('/cwd')[0]?.title).toBe('renamed')
    expect(store.loadVisibleMessages('chat')).toEqual(messages)

    store.saveMessages('chat', [])
    expect(store.loadVisibleMessages('chat')).toEqual(messages)
    store.dispose()
  })

  it('loads model messages from the latest compaction', async () => {
    const store = await createStore()
    save(store, 'chat', [message('one', 'old')], '/cwd', 'chat')
    store.saveStart('chat', compaction('compact', 'current query', 'previous summary'))
    save(store, 'chat', [message('two', 'new')], '/cwd', 'chat')

    expect(store.loadVisibleMessages('chat')).toEqual([
      message('one', 'old'),
      message('two', 'new')
    ])
    expect(store.loadMessages('chat')).toMatchObject([
      {
        role: 'user',
        metadata: { compaction: true },
        parts: [{ type: 'text', text: 'current query\n\nprevious summary' }]
      },
      message('two', 'new')
    ])
    store.dispose()
  })

  it('keeps the compaction cursor internal', async () => {
    const store = await createStore()
    save(store, 'chat', [message('one', 'old')], '/cwd', 'chat')
    store.saveStart('chat', compaction('compact', 'query', 'summary'))

    expect(store.listSessions('/cwd')[0]).not.toHaveProperty('start')
    store.dispose()
  })

  it('uses only the latest compaction for model messages', async () => {
    const store = await createStore()
    save(store, 'chat', [message('one', 'old')], '/cwd', 'chat')
    store.saveStart('chat', compaction('first', 'first query', 'first summary'))
    save(store, 'chat', [message('two', 'middle')], '/cwd', 'chat')
    store.saveStart('chat', compaction('latest', 'latest query', 'latest summary'))
    save(store, 'chat', [message('three', 'new')], '/cwd', 'chat')

    expect(store.loadVisibleMessages('chat')).toEqual([
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
    expect(store.countMessages('chat')).toBe(3)
    store.dispose()
  })

  it('paginates visible messages without compaction messages', async () => {
    const store = await createStore()
    save(store, 'chat', [message('one', 'one')], '/cwd', 'chat')
    store.saveStart('chat', compaction('compact', 'query', 'summary'))
    save(store, 'chat', [message('two', 'two'), message('three', 'three')], '/cwd', 'chat')

    expect(store.loadVisibleMessages('chat', 0, 2)).toEqual([
      message('one', 'one'),
      message('two', 'two')
    ])
    expect(store.loadVisibleMessages('chat', 2, 2)).toEqual([message('three', 'three')])
    expect(store.countMessages('chat')).toBe(3)
    store.dispose()
  })

  it('keeps count and pages aligned for a large conversation', async () => {
    const store = await createStore()
    const messages = Array.from({ length: 5000 }, (_, index) =>
      message(`message-${index}`, `message ${index}`)
    )
    save(store, 'large', messages, '/cwd', 'large')

    expect(store.countMessages('large')).toBe(5000)
    expect(store.loadVisibleMessages('large', 0, 2)).toEqual(messages.slice(0, 2))
    expect(store.loadVisibleMessages('large', 4998, 2)).toEqual(messages.slice(4998))
    expect(store.loadVisibleMessages('large', 5000, 2)).toEqual([])
    store.dispose()
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
    store.dispose()
  })

  it('moves a session to the top after saving a new message', async () => {
    const store = await createStore()
    save(store, 'first', [message('one', 'first')], '/workspace', 'first')
    await new Promise((resolve) => setTimeout(resolve, 2))
    save(store, 'second', [message('two', 'second')], '/workspace', 'second')
    await new Promise((resolve) => setTimeout(resolve, 2))
    store.saveMessages('first', [message('three', 'new')])

    expect(store.listSessions('/workspace').map(({ id }) => id)).toEqual(['first', 'second'])
    store.dispose()
  })

  it('lists sessions by page', async () => {
    const store = await createStore()
    await save(store, 'first', [], '/workspace', 'first')
    await new Promise((resolve) => setTimeout(resolve, 2))
    await save(store, 'second', [], '/workspace', 'second')

    expect(await store.listSessions('/workspace', 1, 1)).toMatchObject([{ id: 'first' }])
    store.dispose()
  })

  it('lists workspaces by recent activity', async () => {
    const store = await createStore()
    await save(store, 'first', [], '/first', 'first')
    await new Promise((resolve) => setTimeout(resolve, 2))
    await save(store, 'second', [], '/second', 'second')

    expect(await store.listCwds()).toEqual(['/second', '/first'])
    store.dispose()
  })

  it('rolls back a failed save', async () => {
    const store = await createStore()
    await save(store, 'chat', [message('one', 'valid')], '/cwd', 'chat')
    const invalid = [{ ...message('two', 'invalid'), parts: [1n] }] as unknown as UIMessage[]

    expect(() => save(store, 'chat', invalid, '/changed', 'chat')).toThrow()
    expect(store.loadVisibleMessages('chat')).toEqual([message('one', 'valid')])
    expect(store.listSessions('/cwd')[0]?.cwd).toBe('/cwd')
    store.dispose()
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
    store.dispose()
  })

  it('rejects a compaction for a missing session', async () => {
    const store = await createStore()

    expect(() => store.saveStart('missing', compaction('compact', 'query', 'summary'))).toThrow(
      'Session not found: missing'
    )
    expect(store.loadMessages('missing')).toEqual([])
    store.dispose()
  })
})
