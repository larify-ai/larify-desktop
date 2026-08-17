import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  head: vi.fn(),
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
vi.mock('../../../../src/main/core/git/head', () => ({ head: mocks.head }))

import { registerGit } from '../../../../src/main/core/git/ipc'

describe('Git IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.head.mockReset()
    mocks.status.mockReset()
  })

  it('returns statuses for the requested workspace', async () => {
    const result = [{ path: 'file.ts' }]
    mocks.status.mockResolvedValue(result)
    const registry = { register: vi.fn() }
    registerGit({ registry } as never)

    await expect(mocks.handlers.get('git:status')?.({}, 'D:\\workspace')).resolves.toBe(result)
    expect(mocks.status).toHaveBeenCalledWith('D:\\workspace', undefined, true)
  })

  it('requests status without ignored files for the changes view', async () => {
    mocks.status.mockResolvedValue([])
    registerGit({ registry: { register: vi.fn() } } as never)

    await mocks.handlers.get('git:status')?.({}, 'D:\\workspace', false)

    expect(mocks.status).toHaveBeenCalledWith('D:\\workspace', undefined, false)
  })

  it('returns no decorations when Git is unavailable', async () => {
    mocks.status.mockRejectedValue(new Error('not a repository'))
    registerGit({ registry: { register: vi.fn() } } as never)

    await expect(mocks.handlers.get('git:status')?.({}, 'D:\\workspace')).resolves.toEqual([])
  })

  it('returns the HEAD contents for the requested workspace file', async () => {
    const result = new Uint8Array([1, 2, 3])
    mocks.head.mockResolvedValue(result)
    registerGit({ registry: { register: vi.fn() } } as never)

    await expect(
      mocks.handlers.get('git:original')?.({}, 'D:\\workspace', 'D:\\workspace\\file.ts')
    ).resolves.toBe(result)
    expect(mocks.head).toHaveBeenCalledWith('D:\\workspace', 'D:\\workspace\\file.ts')
  })

  it('passes original-file errors to the renderer', async () => {
    const error = new Error('outside workspace')
    mocks.head.mockRejectedValue(error)
    registerGit({ registry: { register: vi.fn() } } as never)

    await expect(
      mocks.handlers.get('git:original')?.({}, 'D:\\workspace', 'D:\\outside.txt')
    ).rejects.toBe(error)
  })

  it('removes its handler when the application is disposed', () => {
    const registry = { register: vi.fn() }
    registerGit({ registry } as never)

    const disposable = registry.register.mock.calls[0][1]
    disposable.dispose()

    expect(mocks.handlers.has('git:status')).toBe(false)
    expect(mocks.handlers.has('git:original')).toBe(false)
  })
})
