import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  return {
    handlers,
    emit: (event: string, ...args: unknown[]): void => {
      for (const handler of handlers[event] ?? []) handler(...args)
    },
    handle: vi.fn(),
    removeHandler: vi.fn(),
    autoUpdater: {
      disableDifferentialDownload: false,
      autoDownload: true,
      autoInstallOnAppQuit: true,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue({}),
      downloadUpdate: vi.fn().mockResolvedValue([]),
      quitAndInstall: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void): void => {
        ;(handlers[event] ??= []).push(handler)
      }),
      removeListener: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler }
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mocks.autoUpdater }
}))

import { registerUpdate } from '../../../src/main/update/service'

interface TestWin {
  isDestroyed: ReturnType<typeof vi.fn>
  webContents: { send: ReturnType<typeof vi.fn> }
}

function buildWindow(): TestWin {
  return { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } }
}

function buildApplication(
  window: TestWin,
  register = vi.fn(),
  isPackaged = true
): { application: unknown } {
  return {
    application: {
      electron: { isPackaged, getVersion: vi.fn(() => '0.0.11') },
      window: { get: () => window },
      registry: { register }
    }
  }
}

describe('registerUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mocks.handlers)) delete mocks.handlers[key]
  })

  it('configures the CNB feed and registers update listeners + IPC', () => {
    const window = buildWindow()
    const register = vi.fn()
    registerUpdate(buildApplication(window, register).application as never)

    expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'generic', useMultipleRangeRequest: false })
    )
    // 禁用差量下载（CDN 不支持 Range，差量必失败回退导致进度回退）。
    expect(mocks.autoUpdater.disableDifferentialDownload).toBe(true)
    // 关掉两个默认静默行为：后台静默下载、关 app 时静默安装。
    expect(mocks.autoUpdater.autoDownload).toBe(false)
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(mocks.autoUpdater.on).toHaveBeenCalledTimes(3)
    expect(mocks.handle.mock.calls.map(([ch]) => ch)).toEqual([
      'update:check',
      'update:install',
      'update:downloadedVersion'
    ])
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('broadcasts progress / ready / error and remembers the downloaded version', () => {
    const window = buildWindow()
    const register = vi.fn()
    registerUpdate(buildApplication(window, register).application as never)

    mocks.emit('download-progress', { percent: 42 })
    expect(window.webContents.send).toHaveBeenCalledWith(
      'update:progress',
      expect.objectContaining({ percent: 42 })
    )

    mocks.emit('update-downloaded', { version: '0.0.12' })
    expect(window.webContents.send).toHaveBeenCalledWith('update:ready', '0.0.12')

    mocks.emit('error', new Error('boom'))
    expect(window.webContents.send).toHaveBeenCalledWith('update:error', 'boom')
  })

  it('does not broadcast to a destroyed window', () => {
    const window = buildWindow()
    window.isDestroyed.mockReturnValue(true)
    const register = vi.fn()
    registerUpdate(buildApplication(window, register).application as never)

    mocks.emit('download-progress', { percent: 10 })

    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('update:check reports available/development/current based on the check result', async () => {
    const window = buildWindow()
    const register = vi.fn()
    registerUpdate(buildApplication(window, register).application as never)
    const handlers = Object.fromEntries(mocks.handle.mock.calls)

    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce({
      isUpdateAvailable: true,
      updateInfo: { version: '0.0.12' }
    })
    await expect(handlers['update:check']()).resolves.toEqual({
      status: 'available',
      version: '0.0.12'
    })
    // 用户点「检查更新」即触发下载（autoDownload=false 时唯一的下载入口）。
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce()

    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false })
    await expect(handlers['update:check']()).resolves.toEqual({ status: 'current' })
    // 已是最新 ⇒ 不下载。
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
  })

  it('update:check returns development for an unpackaged build', async () => {
    const window = buildWindow()
    const register = vi.fn()
    registerUpdate(buildApplication(window, register, false).application as never)
    const handlers = Object.fromEntries(mocks.handle.mock.calls)

    await expect(handlers['update:check']()).resolves.toEqual({ status: 'development' })
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('update:install calls quitAndInstall and update:downloadedVersion returns the version', () => {
    const window = buildWindow()
    const register = vi.fn()
    registerUpdate(buildApplication(window, register).application as never)
    const handlers = Object.fromEntries(mocks.handle.mock.calls)

    mocks.emit('update-downloaded', { version: '0.0.12' })
    expect(handlers['update:downloadedVersion']()).toBe('0.0.12')

    mocks.emit('update-downloaded', { version: '0.0.13' })
    expect(handlers['update:downloadedVersion']()).toBe('0.0.13')

    handlers['update:install']()
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('dispose removes listeners and IPC handlers', () => {
    const window = buildWindow()
    const register = vi.fn()
    registerUpdate(buildApplication(window, register).application as never)

    const disposable = register.mock.calls[0][1]
    disposable.dispose()

    expect(mocks.autoUpdater.removeListener).toHaveBeenCalledTimes(3)
    expect(mocks.removeHandler.mock.calls.map(([ch]) => ch)).toEqual([
      'update:check',
      'update:install',
      'update:downloadedVersion'
    ])
  })
})
