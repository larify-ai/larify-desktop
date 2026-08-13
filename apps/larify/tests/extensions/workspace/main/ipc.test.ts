import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    }
  }
})

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }))

import { registerWorkspaceIpc } from '../../../../src/extensions/workspace/main/ipc'

const createWindow = (): {
  isDestroyed: ReturnType<typeof vi.fn>
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  }
} => ({
  isDestroyed: vi.fn(() => false),
  webContents: { isDestroyed: vi.fn(() => false), send: vi.fn() }
})

describe('workspace IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('routes reads and changes by resource id', async () => {
    let listener!: (id: number, event: string, path: string) => void
    const manager = {
      bindChange: vi.fn((value) => {
        listener = value
        return vi.fn()
      }),
      list: vi.fn(async () => ({ entries: [], root: 'D:\\workspace' }))
    }
    const window = createWindow()
    registerWorkspaceIpc(manager as never, window as never)

    await electron.handlers.get('workspace:list')?.(
      {} as never,
      7 as never,
      'D:\\workspace\\src' as never
    )
    expect(manager.list).toHaveBeenCalledWith(7, 'D:\\workspace\\src')

    listener(7, 'add', 'D:\\workspace\\file.ts')
    expect(window.webContents.send).toHaveBeenCalledWith(
      'workspace:change',
      7,
      'add',
      'D:\\workspace\\file.ts'
    )
  })

  it('unbinds changes and removes handlers on unregister', () => {
    const unbind = vi.fn()
    const manager = { bindChange: vi.fn(() => unbind) }
    const unregister = registerWorkspaceIpc(manager as never, createWindow() as never)

    unregister()

    expect(unbind).toHaveBeenCalledOnce()
    expect(electron.handlers.size).toBe(0)
  })

  it('does not send changes to a destroyed window', () => {
    let listener!: (id: number, event: string, path: string) => void
    const manager = {
      bindChange: vi.fn((value) => {
        listener = value
        return vi.fn()
      })
    }
    const window = createWindow()
    window.isDestroyed.mockReturnValue(true)
    registerWorkspaceIpc(manager as never, window as never)

    listener(7, 'change', 'D:\\workspace\\file.ts')

    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
