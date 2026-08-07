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
  it('uses persisted ordering and does not duplicate a retried request', async () => {
    const store = await createStore()
    const user = message('user', 'user', 'hello')
    const firstResponse = message('assistant-1', 'assistant', 'first')
    const secondResponse = message('assistant-2', 'assistant', 'second')
    mocks.run
      .mockImplementationOnce(async (messages, _options, _onChunk, onMessage) => {
        expect(messages).toEqual([user])
        onMessage(firstResponse)
      })
      .mockImplementationOnce(async (messages, _options, _onChunk, onMessage) => {
        expect(messages).toEqual([user, firstResponse])
        onMessage(secondResponse)
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
