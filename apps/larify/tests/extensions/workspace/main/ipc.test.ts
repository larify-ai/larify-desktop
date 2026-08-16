import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const listeners = new Map<string, (...args: never[]) => unknown>()
  return {
    handlers,
    listeners,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      on: vi.fn((channel: string, listener: (...args: never[]) => unknown) =>
        listeners.set(channel, listener)
      ),
      removeListener: vi.fn((channel: string) => listeners.delete(channel))
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
    electron.listeners.clear()
    vi.clearAllMocks()
  })

  it('routes reads and changes by resource id', async () => {
    let listener!: (id: number, directory: string, changedPath: string) => void
    const manager = {
      bindChange: vi.fn((value) => {
        listener = value
        return vi.fn()
      }),
      list: vi.fn(async () => ({ entries: [], root: 'D:\\workspace' })),
      inspectFile: vi.fn(async () => ({ binary: false, mime: 'text/plain', path: 'file.ts' })),
      readAsset: vi.fn(async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' })),
      readFile: vi.fn(async () => 'content'),
      reveal: vi.fn(async () => ['D:\\workspace\\file.ts'])
    }
    const window = createWindow()
    const previews = createPreviews()
    registerWorkspaceIpc(manager as never, previews as never, window as never)

    await electron.handlers.get('workspace:list')?.(
      {} as never,
      7 as never,
      'D:\\workspace\\src' as never
    )
    expect(manager.list).toHaveBeenCalledWith(7, 'D:\\workspace\\src')

    await electron.handlers.get('workspace:inspect')?.({} as never, 7 as never, 'file.ts' as never)
    expect(manager.inspectFile).toHaveBeenCalledWith(7, 'file.ts')

    await electron.handlers.get('workspace:read')?.({} as never, 7 as never, 'file.ts' as never)
    expect(manager.readFile).toHaveBeenCalledWith(7, 'file.ts')

    const asset = await electron.handlers.get('workspace:read-asset')?.(
      {} as never,
      7 as never,
      'image.png' as never
    )
    expect(manager.readAsset).toHaveBeenCalledWith(7, 'image.png')
    expect(asset).toEqual({ bytes: new Uint8Array([1]), mime: 'image/png' })

    await electron.handlers.get('workspace:reveal')?.({} as never, 7 as never, 'file.ts' as never)
    expect(manager.reveal).toHaveBeenCalledWith(7, 'file.ts')

    listener(7, 'D:\\workspace', 'D:\\workspace\\file.ts')
    expect(window.webContents.send).toHaveBeenCalledWith(
      'workspace:change',
      7,
      'D:\\workspace',
      'D:\\workspace\\file.ts'
    )

    await electron.handlers.get('workspace-preview:open')?.(
      {} as never,
      7 as never,
      'D:\\workspace\\page.pdf' as never,
      'application/pdf' as never,
      '#111' as never,
      { x: 1, y: 2, width: 300, height: 200 } as never,
      true as never
    )
    expect(previews.open).toHaveBeenCalledWith(
      7,
      'D:\\workspace\\page.pdf',
      'application/pdf',
      '#111',
      { x: 1, y: 2, width: 300, height: 200 },
      true
    )

    const boundsEvent = {} as { returnValue?: boolean }
    electron.listeners.get('workspace-preview:setBoundsSync')?.(
      boundsEvent as never,
      7 as never,
      { x: 1, y: 2, width: 300, height: 200 } as never
    )
    expect(previews.setBounds).toHaveBeenCalledWith(7, {
      x: 1,
      y: 2,
      width: 300,
      height: 200
    })
    expect(boundsEvent.returnValue).toBe(true)

    electron.listeners.get('workspace-preview:setVisible')?.({} as never, 7 as never, true as never)
    expect(previews.setVisible).toHaveBeenCalledWith(7, true)

    electron.listeners.get('workspace-preview:close')?.({} as never, 7 as never)
    expect(previews.close).toHaveBeenCalledWith(7)
  })

  it('unbinds changes and removes handlers on unregister', () => {
    const unbind = vi.fn()
    const manager = { bindChange: vi.fn(() => unbind) }
    const unregister = registerWorkspaceIpc(
      manager as never,
      createPreviews() as never,
      createWindow() as never
    )

    unregister()

    expect(unbind).toHaveBeenCalledOnce()
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('workspace:read-asset')
    expect(electron.handlers.size).toBe(0)
    expect(electron.listeners.size).toBe(0)
  })

  it('does not send changes to a destroyed window', () => {
    let listener!: (id: number, directory: string, changedPath: string) => void
    const manager = {
      bindChange: vi.fn((value) => {
        listener = value
        return vi.fn()
      })
    }
    const window = createWindow()
    window.isDestroyed.mockReturnValue(true)
    registerWorkspaceIpc(manager as never, createPreviews() as never, window as never)

    listener(7, 'D:\\workspace', 'D:\\workspace\\file.ts')

    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})

const createPreviews = (): {
  close: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  setVisible: ReturnType<typeof vi.fn>
} => ({
  open: vi.fn(),
  setBounds: vi.fn(),
  setVisible: vi.fn(),
  close: vi.fn()
})
