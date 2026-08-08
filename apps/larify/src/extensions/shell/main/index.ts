import { app, screen, ipcMain, nativeTheme, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { Extension } from '@shared/extension'
import { NativeTooltip, type NativeTooltipOptions } from './native-tooltip'

const isMac = process.platform === 'darwin'
const titleBarHeight = 45
const titleBarSymbolColor = (): string => (nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000')

function syncTitleBar(window: BrowserWindow): void {
  if (isMac || window.isDestroyed()) return
  window.setTitleBarOverlay({
    color: 'rgba(0,0,0,0)',
    symbolColor: titleBarSymbolColor(),
    height: titleBarHeight
  })
}

function isExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function openInBrowser(window: BrowserWindow, value: string): void {
  if (isExternalUrl(value) && !window.webContents.isDestroyed()) {
    window.webContents.send('browser:open-url', value)
  }
}

function isRendererUrl(value: string): boolean {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!is.dev || !rendererUrl) return false
  try {
    return new URL(value).origin === new URL(rendererUrl).origin
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(1280, workArea.width - 80)
  const height = Math.min(800, workArea.height - 80)
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    ...(process.platform === 'win32'
      ? { icon: join(app.getAppPath(), 'resources', 'icon.png') }
      : {}),
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    show: false,
    title: 'Larify',
    titleBarStyle: 'hidden',
    ...(isMac
      ? {}
      : {
          titleBarOverlay: {
            color: 'rgba(0,0,0,0)',
            symbolColor: titleBarSymbolColor(),
            height: titleBarHeight
          }
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    openInBrowser(win, details.url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    openInBrowser(win, url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

const extension: Extension = {
  activate(appHost, context) {
    let win: BrowserWindow | null = createWindow()
    let tooltip: NativeTooltip | null = null
    let tooltipDestroyTimer: ReturnType<typeof setTimeout> | undefined
    const prepareTooltip = (owner: BrowserWindow): NativeTooltip => {
      clearTimeout(tooltipDestroyTimer)
      if (tooltip && !tooltip.isOwnedBy(owner)) {
        tooltip.destroy()
        tooltip = null
      }
      if (!tooltip || tooltip.isDestroyed()) tooltip = new NativeTooltip(owner)
      return tooltip
    }
    const hideTooltip = (): void => {
      tooltip?.hide()
      clearTimeout(tooltipDestroyTimer)
      tooltipDestroyTimer = setTimeout(() => {
        tooltip?.destroy()
        tooltip = null
      }, 30_000)
    }
    const getWindow = (): BrowserWindow => {
      if (!win || win.isDestroyed()) win = createWindow()
      return win
    }
    context.subscriptions.push(appHost.register('service', 'main-window', { get: getWindow }))
    context.subscriptions.push({
      dispose: () => {
        const current = win
        win = null
        clearTimeout(tooltipDestroyTimer)
        tooltip?.destroy()
        tooltip = null
        if (current && !current.isDestroyed()) current.destroy()
      }
    })

    ipcMain.handle('theme:set', (_e, theme) => {
      if (theme === 'light' || theme === 'dark' || theme === 'system') {
        nativeTheme.themeSource = theme
        const window = BrowserWindow.fromWebContents(_e.sender)
        if (window) syncTitleBar(window)
      }
    })
    ipcMain.handle('tooltip:show', (event, options: NativeTooltipOptions) => {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
      return prepareTooltip(owner).show(options)
    })
    ipcMain.handle('tooltip:hide', hideTooltip)
    ipcMain.handle('dialog:pick-directories', async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
      const result = await dialog.showOpenDialog(owner, {
        properties: ['openDirectory', 'multiSelections']
      })
      return result.canceled ? [] : result.filePaths
    })
    context.subscriptions.push({
      dispose: () => {
        ipcMain.removeHandler('theme:set')
        ipcMain.removeHandler('tooltip:show')
        ipcMain.removeHandler('tooltip:hide')
        ipcMain.removeHandler('dialog:pick-directories')
      }
    })

    const onActivate = (): void => {
      if (!win || win.isDestroyed()) getWindow()
    }
    const onNativeThemeUpdated = (): void => {
      if (win) syncTitleBar(win)
    }
    app.on('activate', onActivate)
    nativeTheme.on('updated', onNativeThemeUpdated)
    context.subscriptions.push({
      dispose: () => {
        app.removeListener('activate', onActivate)
        nativeTheme.removeListener('updated', onNativeThemeUpdated)
      }
    })
  }
}

export default extension
