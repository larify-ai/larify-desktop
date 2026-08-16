import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  status: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => mocks.handlers.delete(channel))
  }
}))
vi.mock('../../../../src/main/core/git/status', () => ({ status: mocks.status }))

import { registerGit } from '../../../../src/main/core/git/ipc'

describe('Git IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.status.mockReset()
  })

  it('returns statuses for the requested workspace', async () => {
    const result = [{ path: 'file.ts' }]
    mocks.status.mockResolvedValue(result)
    const registry = { register: vi.fn() }
    registerGit({ registry } as never)

    await expect(mocks.handlers.get('git:status')?.({}, 'D:\\workspace')).resolves.toBe(result)
    expect(mocks.status).toHaveBeenCalledWith('D:\\workspace')
  })

  it('returns no decorations when Git is unavailable', async () => {
    mocks.status.mockRejectedValue(new Error('not a repository'))
    registerGit({ registry: { register: vi.fn() } } as never)

    await expect(mocks.handlers.get('git:status')?.({}, 'D:\\workspace')).resolves.toEqual([])
  })

  it('removes its handler when the application is disposed', () => {
    const registry = { register: vi.fn() }
    registerGit({ registry } as never)

    const disposable = registry.register.mock.calls[0][1]
    disposable.dispose()

    expect(mocks.handlers.has('git:status')).toBe(false)
  })
})
