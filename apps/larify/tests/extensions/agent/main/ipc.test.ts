import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => {
      mocks.removeHandler(channel)
      mocks.handlers.delete(channel)
    }
  }
}))

import { registerAgentHandlers } from '../../../../src/main/core/agent/ipc'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.removeHandler.mockClear()
})

describe('agent IPC', () => {
  it('registers and removes agent handlers', async () => {
    const disposable = registerAgentHandlers({ send: vi.fn(), cancel: vi.fn() } as never)

    expect([...mocks.handlers.keys()].sort()).toEqual(['agent:cancel', 'agent:send'])
    await disposable.dispose()
    expect(mocks.handlers.size).toBe(0)
  })
})
