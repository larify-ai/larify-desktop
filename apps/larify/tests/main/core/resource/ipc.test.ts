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
  it('exposes create, list, and close operations and publishes resource changes', async () => {
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
    const setActiveSession = vi.spyOn(manager, 'setActiveSession')
    const list = vi.spyOn(manager, 'list')
    manager.register('terminal', factory)

    expect(mocks.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      'resource:create',
      'resource:list',
      'resource:close',
      'resource:close-many',
      'resource:set-active-session'
    ])
    mocks.removeHandler.mockClear()

    const id = handlers.get('resource:create')?.({}, 'terminal', 'session-a', { cwd: '/tmp' })
    expect(factory).toHaveBeenCalledWith(id, 'session-a', { cwd: '/tmp' })
    expect(list).toHaveBeenCalledOnce()
    expect(send).toHaveBeenLastCalledWith('resource:change', [
      { id, type: 'terminal', sessionId: 'session-a' }
    ])
    expect(handlers.get('resource:list')?.()).toEqual([
      { id, type: 'terminal', sessionId: 'session-a' }
    ])
    expect(handlers.get('resource:list')?.({}, { type: 'browser' })).toEqual([])
    handlers.get('resource:set-active-session')?.({}, 'session-a')
    expect(setActiveSession).toHaveBeenCalledWith('session-a')

    await handlers.get('resource:close')?.({}, id)
    expect(close).toHaveBeenCalledOnce()

    const other = handlers.get('resource:create')?.({}, 'terminal', 'session-a')
    await handlers.get('resource:close-many')?.({}, [other])
    expect(close).toHaveBeenCalledTimes(2)

    dispose()
    expect(mocks.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      'resource:create',
      'resource:list',
      'resource:close',
      'resource:close-many',
      'resource:set-active-session'
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

  it('does not send after its web contents has been destroyed', () => {
    const manager = new ResourceManager()
    const send = vi.fn()
    registerResourceIpc(manager, {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => true, send }
    } as never)
    manager.register('terminal', () => ({ dispose: vi.fn() }))

    manager.create('terminal', 'session-a')

    expect(send).not.toHaveBeenCalled()
  })
})
