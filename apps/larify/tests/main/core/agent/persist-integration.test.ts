import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('../../../../src/main/core/agent/messages', () => ({
  prepareMessages: (messages: UIMessage[]) => messages
}))
vi.mock('../../../../src/main/core/agent/session', () => ({
  runAgentSession: mocks.run
}))

import { runStoredAgentSession } from '../../../../src/main/core/agent/persist'
import { SessionStore } from '../../../../src/main/core/session'

const directories: string[] = []
const message = (id: string, role: 'user' | 'assistant', text: string): UIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }]
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function createStore(): Promise<SessionStore> {
  const directory = await mkdtemp(join(tmpdir(), 'larify-agent-persist-'))
  directories.push(directory)
  return new SessionStore(join(directory, 'sessions.db'))
}

describe('runStoredAgentSession persistence', () => {
  it('replaces the step snapshot with the complete final UIMessage and restores it after reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'larify-agent-persist-'))
    directories.push(directory)
    const database = join(directory, 'sessions.db')
    const user = message('user', 'user', 'hello')
    const step: UIMessage = {
      id: 'assistant',
      role: 'assistant',
      metadata: { startedAt: 1_000 },
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'checking' },
        { type: 'text', text: 'partial' }
      ]
    }
    const final: UIMessage = {
      ...step,
      metadata: { startedAt: 1_000, completedAt: 4_000 },
      parts: [
        ...step.parts,
        {
          type: 'data-git-snapshot',
          id: 'review',
          data: {
            files: [
              {
                additions: 1,
                binary: false,
                deletions: 0,
                patch: '@@ -0,0 +1 @@\n+saved\n',
                path: 'saved.txt'
              }
            ],
            root: '/workspace'
          }
        } as never,
        { type: 'text', text: 'complete' }
      ]
    }
    mocks.run.mockImplementation(async (messages, _options, _onChunk, onMessage) => {
      onMessage(step)
      return [...messages, final]
    })

    const store = new SessionStore(database)
    await expect(
      runStoredAgentSession(store, {
        sessionId: 'session',
        cwd: '/workspace',
        message: user,
        options: {} as never
      })
    ).resolves.toEqual(final)
    expect(store.loadMessages('session')).toEqual([user, final])
    store.dispose()

    const reopened = new SessionStore(database)
    expect(reopened.loadMessages('session')).toEqual([user, final])
    reopened.dispose()
  })

  it('restores a persisted final Git patch after reopening the session store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'larify-agent-persist-'))
    directories.push(directory)
    const database = join(directory, 'sessions.db')
    const assistant: UIMessage = {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'data-git-snapshot',
          id: 'review',
          data: {
            files: [
              {
                additions: 1,
                binary: false,
                deletions: 0,
                patch: '@@ -0,0 +1 @@\n+saved\n',
                path: 'saved.txt'
              }
            ],
            root: '/workspace'
          }
        } as never
      ]
    }
    const first = new SessionStore(database)
    first.createSession({ cwd: '/workspace', id: 'session', title: 'Session' })
    first.saveMessages('session', [assistant])
    first.dispose()

    const reopened = new SessionStore(database)
    expect(reopened.loadMessages('session')).toEqual([assistant])
    reopened.dispose()
  })

  it('uses persisted ordering and does not duplicate a retried request', async () => {
    const store = await createStore()
    const user = message('user', 'user', 'hello')
    const firstResponse = message('assistant-1', 'assistant', 'first')
    const secondResponse = message('assistant-2', 'assistant', 'second')
    mocks.run
      .mockImplementationOnce(async (messages, _options, _onChunk, onMessage) => {
        expect(messages).toEqual([user])
        onMessage(firstResponse)
        return [user, firstResponse]
      })
      .mockImplementationOnce(async (messages, _options, _onChunk, onMessage) => {
        expect(messages).toEqual([user, firstResponse])
        onMessage(secondResponse)
        return [user, firstResponse, secondResponse]
      })

    const request = {
      sessionId: 'session',
      cwd: '/workspace',
      message: user,
      options: {} as never
    }
    await runStoredAgentSession(store, request)
    await runStoredAgentSession(store, request)

    expect(store.loadMessages('session')).toEqual([user, firstResponse, secondResponse])
    store.dispose()
  })

  it('keeps the request when execution fails', async () => {
    const store = await createStore()
    const user = message('user', 'user', 'hello')
    mocks.run.mockRejectedValue(new Error('failed'))

    await expect(
      runStoredAgentSession(store, {
        sessionId: 'session',
        cwd: '/workspace',
        message: user,
        options: {} as never
      })
    ).rejects.toThrow('failed')

    expect(store.loadMessages('session')).toEqual([user])
    store.dispose()
  })
})
