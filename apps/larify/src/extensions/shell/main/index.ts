import { app, screen, shell, ipcMain, nativeTheme, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { Extension } from 'kernel'
import { NativeTooltip, type NativeTooltipOptions } from './native-tooltip'

const isMac = process.platform === 'darwin'

function isExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function openExternalUrl(value: string): void {
  if (isExternalUrl(value)) {
    void shell.openExternal(value).catch(() => {})
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
            symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffffcc' : '#000000e5',
            height: 32
          }
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    openExternalUrl(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openExternalUrl(url)
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
      }
    })
    ipcMain.handle('titlebar:set-symbol', (event, symbolColor) => {
      if (isMac || typeof symbolColor !== 'string') return
      BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay({
        color: 'rgba(0,0,0,0)',
        symbolColor,
        height: 32
      })
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
        ipcMain.removeHandler('titlebar:set-symbol')
        ipcMain.removeHandler('tooltip:show')
        ipcMain.removeHandler('tooltip:hide')
        ipcMain.removeHandler('dialog:pick-directories')
      }
    })

    const onActivate = (): void => {
      if (!win || win.isDestroyed()) getWindow()
    }
    app.on('activate', onActivate)
    context.subscriptions.push({
      dispose: () => {
        app.removeListener('activate', onActivate)
      }
    })
  }
}

export default extension
