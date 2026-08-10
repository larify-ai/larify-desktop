import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceManager } from '../../../../src/main/core/resource/manager'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle,
    removeHandler: mocks.removeHandler
  }
}))

import { registerResourceIpc } from '../../../../src/main/core/resource/ipc'

beforeEach(() => {
  mocks.handle.mockReset()
  mocks.removeHandler.mockReset()
})

describe('registerResourceIpc', () => {
  it('exposes create, list, and close and publishes resource changes', async () => {
    const manager = new ResourceManager()
    const send = vi.fn()
    const window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send }
    }
    const dispose = registerResourceIpc(manager, window as never)
    const handlers = new Map(
      mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler])
    )
    const close = vi.fn()
    const factory = vi.fn(() => ({ dispose: close }))
    manager.register('terminal', factory)

    const id = handlers.get('resource:create')?.({}, 'terminal', 'session-a', { cwd: '/tmp' })
    expect(factory).toHaveBeenCalledWith(id, 'session-a', { cwd: '/tmp' })
    expect(send).toHaveBeenLastCalledWith('resource:change', [
      { id, type: 'terminal', sessionId: 'session-a' }
    ])
    expect(handlers.get('resource:list')?.()).toEqual([
      { id, type: 'terminal', sessionId: 'session-a' }
    ])
    expect(handlers.get('resource:list')?.({}, { type: 'browser' })).toEqual([])

    await handlers.get('resource:close')?.({}, id)
    expect(close).toHaveBeenCalledOnce()

    dispose()
    expect(mocks.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      'resource:create',
      'resource:list',
      'resource:close'
    ])
  })

  it('does not send after its window has been destroyed', () => {
    const manager = new ResourceManager()
    const send = vi.fn()
    registerResourceIpc(manager, {
      isDestroyed: () => true,
      webContents: { isDestroyed: () => false, send }
    } as never)
    manager.register('terminal', () => ({ dispose: vi.fn() }))

    manager.create('terminal', 'session-a')

    expect(send).not.toHaveBeenCalled()
  })
})
