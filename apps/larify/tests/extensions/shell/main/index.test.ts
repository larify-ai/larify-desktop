import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const appHandlers = new Map<string, () => void>()
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const windows: FakeWindow[] = []
  const openExternal = vi.fn().mockResolvedValue(undefined)

  class FakeWindow {
    destroyed = false
    webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn()
    }

    constructor() {
      windows.push(this)
    }

    on = vi.fn()
    loadURL = vi.fn()
    loadFile = vi.fn()
    show = vi.fn()
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    isDestroyed = (): boolean => this.destroyed

    static getAllWindows = (): FakeWindow[] => windows.filter((window) => !window.destroyed)
    static fromWebContents = (): null => null
  }

  return { appHandlers, ipcHandlers, openExternal, windows, FakeWindow }
})

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'D:\\app',
    on: (event: string, listener: () => void) => h.appHandlers.set(event, listener),
    removeListener: (event: string) => h.appHandlers.delete(event)
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    })
  },
  shell: { openExternal: h.openExternal },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      h.ipcHandlers.set(channel, handler),
    removeHandler: (channel: string) => h.ipcHandlers.delete(channel)
  },
  nativeTheme: { themeSource: 'system' },
  BrowserWindow: h.FakeWindow,
  dialog: { showOpenDialog: vi.fn() }
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import extension from '../../../../src/extensions/shell/main'

describe('shell main window lifecycle', () => {
  beforeEach(() => {
    h.appHandlers.clear()
    h.ipcHandlers.clear()
    h.openExternal.mockClear()
    h.openExternal.mockResolvedValue(undefined)
    h.windows.length = 0
  })

  it('updates the main-window service when the app is activated after closing its window', () => {
    let mainWindowService: { get(): InstanceType<typeof h.FakeWindow> } | undefined
    const subscriptions: Array<{ dispose(): void }> = []
    const appHost = {
      register: vi.fn((_kind: string, name: string, value: unknown) => {
        if (name === 'main-window') {
          mainWindowService = value as { get(): InstanceType<typeof h.FakeWindow> }
        }
        return { dispose: vi.fn() }
      })
    }

    extension.activate(
      appHost as never,
      {
        subscriptions,
        manifest: {}
      } as never
    )

    const first = mainWindowService!.get()
    first.destroy()
    h.appHandlers.get('activate')!()

    const second = mainWindowService!.get()
    expect(second).not.toBe(first)
    expect(second.isDestroyed()).toBe(false)
    expect(h.FakeWindow.getAllWindows()).toEqual([second])
  })

  it('opens only HTTP and HTTPS links outside the app', async () => {
    const subscriptions: Array<{ dispose(): void }> = []
    extension.activate(
      { register: vi.fn(() => ({ dispose: vi.fn() })) } as never,
      { subscriptions, manifest: {} } as never
    )
    const handler = h.windows[0].webContents.setWindowOpenHandler.mock.calls[0][0]

    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'file:///C:/Windows/System32' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'not a URL' })).toEqual({ action: 'deny' })
    await Promise.resolve()

    expect(h.openExternal).toHaveBeenCalledTimes(1)
    expect(h.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('prevents the main window from navigating away', async () => {
    const subscriptions: Array<{ dispose(): void }> = []
    extension.activate(
      { register: vi.fn(() => ({ dispose: vi.fn() })) } as never,
      { subscriptions, manifest: {} } as never
    )
    const handler = h.windows[0].webContents.on.mock.calls.find(
      ([event]) => event === 'will-navigate'
    )?.[1]
    const event = { preventDefault: vi.fn() }

    handler(event, 'https://example.com')
    await Promise.resolve()

    expect(event.preventDefault).toHaveBeenCalledWith()
    expect(h.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('ignores failures while opening an external link', async () => {
    h.openExternal.mockRejectedValueOnce(new Error('Unavailable'))
    const subscriptions: Array<{ dispose(): void }> = []
    extension.activate(
      { register: vi.fn(() => ({ dispose: vi.fn() })) } as never,
      { subscriptions, manifest: {} } as never
    )
    const handler = h.windows[0].webContents.setWindowOpenHandler.mock.calls[0][0]

    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    await expect(Promise.resolve()).resolves.toBeUndefined()
  })
})
