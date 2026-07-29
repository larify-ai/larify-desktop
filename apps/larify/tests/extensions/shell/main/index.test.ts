import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const appHandlers = new Map<string, () => void>()
  const nativeThemeHandlers = new Map<string, () => void>()
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const windows: FakeWindow[] = []
  const openExternal = vi.fn().mockResolvedValue(undefined)
  let isDev = false

  class FakeWindow {
    destroyed = false
    webContents = {
      isDestroyed: () => false,
      on: vi.fn(),
      send: vi.fn(),
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
    setTitleBarOverlay = vi.fn()
    isDestroyed = (): boolean => this.destroyed

    static getAllWindows = (): FakeWindow[] => windows.filter((window) => !window.destroyed)
    static fromWebContents = (): null => null
  }

  return {
    appHandlers,
    ipcHandlers,
    nativeThemeHandlers,
    openExternal,
    windows,
    FakeWindow,
    get isDev() {
      return isDev
    },
    set isDev(value: boolean) {
      isDev = value
    }
  }
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
  nativeTheme: {
    shouldUseDarkColors: false,
    themeSource: 'system',
    on: (event: string, listener: () => void) => h.nativeThemeHandlers.set(event, listener),
    removeListener: (event: string) => h.nativeThemeHandlers.delete(event)
  },
  BrowserWindow: h.FakeWindow,
  dialog: { showOpenDialog: vi.fn() }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return h.isDev
    }
  }
}))

import extension from '../../../../src/extensions/shell/main'

describe('shell main window lifecycle', () => {
  beforeEach(() => {
    h.appHandlers.clear()
    h.ipcHandlers.clear()
    h.nativeThemeHandlers.clear()
    h.openExternal.mockClear()
    h.openExternal.mockResolvedValue(undefined)
    h.windows.length = 0
    h.isDev = false
    delete process.env['ELECTRON_RENDERER_URL']
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

  it('routes only HTTP and HTTPS links to the built-in browser', () => {
    const subscriptions: Array<{ dispose(): void }> = []
    extension.activate(
      { register: vi.fn(() => ({ dispose: vi.fn() })) } as never,
      { subscriptions, manifest: {} } as never
    )
    const handler = h.windows[0].webContents.setWindowOpenHandler.mock.calls[0][0]

    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'file:///C:/Windows/System32' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'not a URL' })).toEqual({ action: 'deny' })
    expect(h.windows[0].webContents.send).toHaveBeenCalledTimes(1)
    expect(h.windows[0].webContents.send).toHaveBeenCalledWith(
      'browser:open-url',
      'https://example.com'
    )
  })

  it('prevents the main window from navigating away', () => {
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
    expect(event.preventDefault).toHaveBeenCalledWith()
    expect(h.windows[0].webContents.send).toHaveBeenCalledWith(
      'browser:open-url',
      'https://example.com'
    )
  })

  it('allows development renderer reloads to stay in Electron', () => {
    h.isDev = true
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    const subscriptions: Array<{ dispose(): void }> = []
    extension.activate(
      { register: vi.fn(() => ({ dispose: vi.fn() })) } as never,
      { subscriptions, manifest: {} } as never
    )
    const handler = h.windows[0].webContents.on.mock.calls.find(
      ([event]) => event === 'will-navigate'
    )?.[1]
    const event = { preventDefault: vi.fn() }

    handler(event, 'http://localhost:5173/')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.windows[0].webContents.send).not.toHaveBeenCalled()
  })

  it('updates title-bar symbols when the system theme changes', () => {
    const subscriptions: Array<{ dispose(): void }> = []
    extension.activate(
      { register: vi.fn(() => ({ dispose: vi.fn() })) } as never,
      { subscriptions, manifest: {} } as never
    )
    const auxiliaryWindow = new h.FakeWindow()

    h.nativeThemeHandlers.get('updated')!()

    expect(h.windows[0].setTitleBarOverlay).toHaveBeenCalledWith({
      color: 'rgba(0,0,0,0)',
      height: 32,
      symbolColor: '#000000'
    })
    expect(auxiliaryWindow.setTitleBarOverlay).not.toHaveBeenCalled()

    for (const subscription of subscriptions) subscription.dispose()
    expect(h.nativeThemeHandlers.has('updated')).toBe(false)
  })
})
