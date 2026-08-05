import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => {
      mocks.removeHandler(channel)
      mocks.handlers.delete(channel)
    }
  }
}))

vi.mock('../../../../src/main/core/agent/message-sanitizer', () => ({
  sanitizeAndValidateMessages: async (messages: unknown[]) => messages
}))

import { registerRunHandlers } from '../../../../src/extensions/agent/main/runner'
import { registerSessionHandlers } from '../../../../src/extensions/agent/main/sessions'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.removeHandler.mockClear()
})

describe('agent IPC', () => {
  it('uses the registered session service and removes every session handler', async () => {
    const sessions = {
      loadSession: vi.fn(),
      saveSession: vi.fn(),
      listSessions: vi.fn(),
      listCwds: vi.fn()
    }
    const app = { get: vi.fn(() => sessions) }
    const disposable = registerSessionHandlers(app as never)

    expect(app.get).toHaveBeenCalledWith('service', 'session')
    expect([...mocks.handlers.keys()].sort()).toEqual([
      'agent:session-cwds',
      'agent:session-list',
      'agent:session-load',
      'agent:session-save'
    ])

    await disposable.dispose()
    expect(mocks.handlers.size).toBe(0)
  })

  it('fails clearly when the session service is unavailable', () => {
    expect(() => registerSessionHandlers({ get: () => undefined } as never)).toThrow(
      'Session service is unavailable.'
    )
  })

  it('registers and removes run handlers', async () => {
    const disposable = registerRunHandlers({} as never, 'prompt')

    expect([...mocks.handlers.keys()].sort()).toEqual(['agent:cancel', 'agent:run'])
    await disposable.dispose()
    expect(mocks.handlers.size).toBe(0)
  })
})
