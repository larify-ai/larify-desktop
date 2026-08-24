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

const fileSystem = vi.hoisted(() => ({ stat: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }))
vi.mock('node:fs/promises', () => ({ stat: fileSystem.stat }))

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

  it.each([
    [true, 'directory'],
    [false, 'file']
  ] as const)('classifies a path as %s=%s', async (directory, kind) => {
    fileSystem.stat.mockResolvedValue({ isDirectory: () => directory })
    const manager = { bindChange: vi.fn(() => vi.fn()) }
    registerWorkspaceIpc(manager as never, createWindow() as never)

    await expect(
      electron.handlers.get('workspace:path-kind')?.({} as never, 'D:\\outside\\target' as never)
    ).resolves.toBe(kind)
    expect(fileSystem.stat).toHaveBeenCalledWith('D:\\outside\\target')
  })

  it('propagates path inspection failures', async () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
    fileSystem.stat.mockRejectedValue(error)
    const manager = { bindChange: vi.fn(() => vi.fn()) }
    registerWorkspaceIpc(manager as never, createWindow() as never)

    await expect(
      electron.handlers.get('workspace:path-kind')?.({} as never, 'missing' as never)
    ).rejects.toBe(error)
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
      reveal: vi.fn(async () => ['D:\\workspace\\file.ts']),
      setActiveSession: vi.fn(async () => undefined)
    }
    const window = createWindow()
    registerWorkspaceIpc(manager as never, window as never)

    expect([...electron.handlers.keys()].sort()).toEqual([
      'workspace:inspect',
      'workspace:list',
      'workspace:path-kind',
      'workspace:read',
      'workspace:read-asset',
      'workspace:reveal',
      'workspace:set-active-session'
    ])

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

    await electron.handlers.get('workspace:set-active-session')?.({} as never, 'session-1' as never)
    expect(manager.setActiveSession).toHaveBeenCalledWith('session-1')

    listener(7, 'D:\\workspace', 'D:\\workspace\\file.ts')
    expect(window.webContents.send).toHaveBeenCalledWith(
      'workspace:change',
      7,
      'D:\\workspace',
      'D:\\workspace\\file.ts'
    )
  })

  it('unbinds changes and removes handlers on unregister', () => {
    const unbind = vi.fn()
    const manager = { bindChange: vi.fn(() => unbind) }
    const unregister = registerWorkspaceIpc(manager as never, createWindow() as never)

    unregister()

    expect(unbind).toHaveBeenCalledOnce()
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('workspace:read-asset')
    expect(electron.handlers.size).toBe(0)
  })

  it('propagates active-session failures', async () => {
    const error = new Error('activation failed')
    const manager = {
      bindChange: vi.fn(() => vi.fn()),
      setActiveSession: vi.fn(async () => Promise.reject(error))
    }
    registerWorkspaceIpc(manager as never, createWindow() as never)

    await expect(
      electron.handlers.get('workspace:set-active-session')?.({} as never, 'session-1' as never)
    ).rejects.toBe(error)
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
    registerWorkspaceIpc(manager as never, window as never)

    listener(7, 'D:\\workspace', 'D:\\workspace\\file.ts')

    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('does not send changes to destroyed web contents', () => {
    let listener!: (id: number, directory: string, changedPath: string) => void
    const manager = {
      bindChange: vi.fn((value) => {
        listener = value
        return vi.fn()
      })
    }
    const window = createWindow()
    window.webContents.isDestroyed.mockReturnValue(true)
    registerWorkspaceIpc(manager as never, window as never)

    listener(7, 'D:\\workspace', 'D:\\workspace\\file.ts')

    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
