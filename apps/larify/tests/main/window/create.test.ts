import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  options: undefined as Electron.BrowserWindowConstructorOptions | undefined,
  maximize: vi.fn(),
  show: vi.fn(),
  loadFile: vi.fn(() => Promise.resolve()),
  webContentsIsDestroyed: vi.fn(() => false),
  webContentsOn: vi.fn(),
  webContentsSend: vi.fn(),
  windowOn: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (options: Electron.BrowserWindowConstructorOptions) {
    electron.options = options
    return {
      webContents: {
        isDestroyed: electron.webContentsIsDestroyed,
        on: electron.webContentsOn,
        send: electron.webContentsSend
      },
      on: electron.windowOn,
      maximize: electron.maximize,
      show: electron.show,
      loadFile: electron.loadFile,
      loadURL: vi.fn(() => Promise.resolve())
    }
  }),
  nativeTheme: { shouldUseDarkColors: true },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    }))
  }
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../../src/main/utils/app-paths', () => ({ resourcePath: vi.fn() }))

import { createWindow } from '../../../src/main/window/create'

beforeEach(() => {
  electron.options = undefined
  electron.loadFile.mockClear()
  electron.maximize.mockClear()
  electron.show.mockClear()
  electron.webContentsOn.mockClear()
  electron.webContentsSend.mockClear()
  electron.windowOn.mockClear()
})

describe('createWindow', () => {
  it('maximizes the window before showing it', () => {
    createWindow()
    const readyToShow = electron.windowOn.mock.calls.find(
      ([event]) => event === 'ready-to-show'
    )?.[1]

    expect(readyToShow).toBeTypeOf('function')
    readyToShow()

    expect(electron.maximize).toHaveBeenCalledOnce()
    expect(electron.show).toHaveBeenCalledOnce()
    expect(electron.maximize.mock.invocationCallOrder[0]).toBeLessThan(
      electron.show.mock.invocationCallOrder[0]
    )
  })

  it('enables webviews without disabling the renderer sandbox', () => {
    createWindow()

    expect(electron.options?.webPreferences).toMatchObject({
      sandbox: true,
      webviewTag: true
    })
  })

  it('only attaches sandboxed browser guests in the browser partition', () => {
    createWindow()
    const handler = electron.webContentsOn.mock.calls.find(
      ([event]) => event === 'will-attach-webview'
    )?.[1]
    const allowed = {
      preload: 'untrusted.js',
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: false,
      allowRunningInsecureContent: true
    }
    const allowedEvent = { preventDefault: vi.fn() }

    handler(allowedEvent, allowed, {
      partition: 'persist:larify-browser',
      src: 'about:blank'
    })

    expect(allowedEvent.preventDefault).not.toHaveBeenCalled()
    expect(allowed).toEqual({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    })

    for (const params of [
      { partition: 'persist:other', src: 'about:blank' },
      { partition: 'persist:larify-browser', src: 'https://example.com' }
    ]) {
      const rejectedEvent = { preventDefault: vi.fn() }
      handler(rejectedEvent, {}, params)
      expect(rejectedEvent.preventDefault).toHaveBeenCalledOnce()
    }
  })
})
