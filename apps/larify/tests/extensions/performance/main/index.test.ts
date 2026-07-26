import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const windows: FakeWindow[] = []
  let shortcut: (() => void) | undefined
  let shortcutRegistrationSucceeds = true

  class FakeWindow {
    destroyed = false
    visible = false
    webContents = { send: vi.fn() }
    once = vi.fn()
    on = vi.fn()
    loadURL = vi.fn(async () => {})
    loadFile = vi.fn(async () => {})
    show = vi.fn(() => {
      this.visible = true
    })
    hide = vi.fn(() => {
      this.visible = false
    })
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    isDestroyed = (): boolean => this.destroyed
    isVisible = (): boolean => this.visible

    constructor() {
      windows.push(this)
    }

    static getAllWindows = (): FakeWindow[] => windows.filter((window) => !window.destroyed)
  }

  return {
    handlers,
    windows,
    FakeWindow,
    getShortcut: () => shortcut,
    setShortcutRegistration: (value: boolean) => {
      shortcutRegistrationSucceeds = value
    },
    globalShortcut: {
      register: vi.fn((_shortcut: string, callback: () => void) => {
        shortcut = callback
        return shortcutRegistrationSucceeds
      }),
      unregister: vi.fn()
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      })
    }
  }
})

vi.mock('electron', () => ({
  app: {
    getAppMetrics: () => [
      { cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 3 } },
      { cpu: { percentCPUUsage: 5 }, memory: { workingSetSize: 7 } }
    ],
    isPackaged: true
  },
  BrowserWindow: h.FakeWindow,
  globalShortcut: h.globalShortcut,
  ipcMain: h.ipcMain
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import extension from '../../../../src/extensions/performance/main'

describe('performance main extension', () => {
  beforeEach(() => {
    h.handlers.clear()
    h.windows.length = 0
    h.setShortcutRegistration(true)
    h.globalShortcut.register.mockClear()
    h.globalShortcut.unregister.mockClear()
    h.ipcMain.handle.mockClear()
    h.ipcMain.removeHandler.mockClear()
  })

  it('keeps packaged collection disabled until the monitor shortcut is used', () => {
    const subscriptions: Array<{ dispose(): void }> = []
    extension.activate({} as never, { manifest: {}, subscriptions } as never)

    const record = h.handlers.get('performance:record')!
    const history = h.handlers.get('performance:history')!
    record(
      {},
      {
        domNodes: 10,
        eventLoopLag: 1,
        fps: 60,
        heap: 20,
        longestTask: 2,
        timestamp: 100
      }
    )
    expect(history({}, 0)).toEqual({ measures: [], samples: [] })

    h.getShortcut()!()
    record(
      {},
      {
        domNodes: 10,
        eventLoopLag: 1,
        fps: 60,
        heap: 20,
        longestTask: 2,
        timestamp: 100
      }
    )

    expect(history({}, 0)).toEqual({
      measures: [],
      samples: [
        {
          cpu: 7,
          domNodes: 10,
          eventLoopLag: 1,
          fps: 60,
          heap: 20,
          longestTask: 2,
          memory: 10 * 1024,
          processes: 2,
          timestamp: 100
        }
      ]
    })
    expect(h.windows).toHaveLength(1)

    subscriptions[0].dispose()
    expect(h.globalShortcut.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+Alt+P')
    expect(h.handlers.size).toBe(0)
  })

  it('does not unregister a shortcut that it failed to register', () => {
    h.setShortcutRegistration(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const subscriptions: Array<{ dispose(): void }> = []

    extension.activate({} as never, { manifest: {}, subscriptions } as never)
    subscriptions[0].dispose()

    expect(h.globalShortcut.unregister).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[performance] Unable to register shortcut CommandOrControl+Shift+Alt+P'
    )
    warn.mockRestore()
  })

  it('shows and hides the existing monitor window without creating another one', () => {
    const subscriptions: Array<{ dispose(): void }> = []
    extension.activate({} as never, { manifest: {}, subscriptions } as never)

    h.getShortcut()!()
    const monitor = h.windows[0]
    h.getShortcut()!()
    expect(monitor.show).toHaveBeenCalledOnce()
    h.getShortcut()!()
    expect(monitor.hide).toHaveBeenCalledOnce()
    expect(h.windows).toHaveLength(1)

    subscriptions[0].dispose()
  })
})
