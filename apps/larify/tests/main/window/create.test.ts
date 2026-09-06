import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  options: undefined as Electron.BrowserWindowConstructorOptions | undefined,
  maximize: vi.fn(),
  show: vi.fn(),
  setSize: vi.fn(),
  loadFile: vi.fn(() => Promise.resolve()),
  webContentsIsDestroyed: vi.fn(() => false),
  webContentsOn: vi.fn(),
  setWindowOpenHandler: vi.fn(),
  webContentsSend: vi.fn(),
  windowOn: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve())
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (options: Electron.BrowserWindowConstructorOptions) {
    electron.options = options
    return {
      webContents: {
        isDestroyed: electron.webContentsIsDestroyed,
        on: electron.webContentsOn,
        setWindowOpenHandler: electron.setWindowOpenHandler,
        send: electron.webContentsSend
      },
      on: electron.windowOn,
      maximize: electron.maximize,
      show: electron.show,
      setSize: electron.setSize,
      loadFile: electron.loadFile,
      loadURL: vi.fn(() => Promise.resolve())
    }
  }),
  nativeTheme: { shouldUseDarkColors: true },
  shell: { openExternal: electron.openExternal },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    }))
  }
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../../src/main/utils/app-paths', () => ({ resourcePath: vi.fn() }))

import { createWindow, isRendererNavigation } from '../../../src/main/window/create'

beforeEach(() => {
  electron.options = undefined
  electron.loadFile.mockClear()
  electron.maximize.mockClear()
  electron.show.mockClear()
  electron.setSize.mockClear()
  electron.webContentsOn.mockClear()
  electron.setWindowOpenHandler.mockClear()
  electron.webContentsSend.mockClear()
  electron.windowOn.mockClear()
  electron.openExternal.mockClear()
})

describe('createWindow', () => {
  it('shows the centered window without maximizing it', () => {
    createWindow()
    const readyToShow = electron.windowOn.mock.calls.find(
      ([event]) => event === 'ready-to-show'
    )?.[1]

    expect(readyToShow).toBeTypeOf('function')
    readyToShow()

    expect(electron.maximize).not.toHaveBeenCalled()
    expect(electron.show).toHaveBeenCalledOnce()
    expect(electron.options).toMatchObject({ width: 1280, height: 820, x: 320, y: 130 })
    // 多显示器混合 DPI 下，显示前用 setSize 按目标 DIP 尺寸矫正窗口物理大小。
    expect(electron.setSize).toHaveBeenCalledWith(1280, 820)
  })

  it('opens only Larify authentication pages in the system browser', () => {
    createWindow()
    const handler = electron.setWindowOpenHandler.mock.calls[0]?.[0]

    expect(handler({ url: 'https://larify.ai/login?client=desktop' })).toEqual({ action: 'deny' })
    expect(electron.openExternal).toHaveBeenCalledWith(
      'https://larify.ai/login?client=desktop'
    )

    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(electron.openExternal).toHaveBeenCalledOnce()
  })

  it('enables webviews without disabling the renderer sandbox', () => {
    createWindow()

    expect(electron.options?.webPreferences).toMatchObject({
      sandbox: true,
      webviewTag: true
    })
  })

  it('allows only the renderer origin during development navigation', () => {
    const rendererUrl = new URL('http://localhost:5175/')
    expect(isRendererNavigation('http://localhost:5175/index.html', rendererUrl, '')).toBe(true)
    expect(isRendererNavigation('http://localhost:5175/', rendererUrl, '')).toBe(true)
    expect(isRendererNavigation('http://localhost:5175.evil.com/', rendererUrl, '')).toBe(false)
    expect(isRendererNavigation('https://example.com', rendererUrl, '')).toBe(false)
    expect(isRendererNavigation('file:///D:/app/out/renderer/index.html', rendererUrl, '')).toBe(
      false
    )
  })

  it('allows only the renderer directory during production file navigation', () => {
    const prefix = 'file:///D:/apps/larify/out/renderer'
    expect(isRendererNavigation(`${prefix}/index.html`, undefined, prefix)).toBe(true)
    expect(isRendererNavigation(`${prefix}/assets/index.js`, undefined, prefix)).toBe(true)
    expect(isRendererNavigation(prefix, undefined, prefix)).toBe(true)
    expect(isRendererNavigation(`${prefix}-evil/index.html`, undefined, prefix)).toBe(false)
    expect(isRendererNavigation('https://example.com', undefined, prefix)).toBe(false)
  })

  it('rejects malformed navigation URLs without throwing', () => {
    expect(isRendererNavigation(':::not a url', undefined, 'file:///out/renderer')).toBe(false)
    expect(() =>
      isRendererNavigation('not a url', new URL('http://localhost:5175/'), '')
    ).not.toThrow()
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
