import { join } from 'node:path'
import { BrowserWindow, nativeTheme, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { BROWSER_PARTITION } from '../../extensions/browser/shared/types'
import { resourcePath } from '../utils/app-paths'

export const titleBarHeight = 46

export function createWindow(): BrowserWindow {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1e1e1f' : '#fafafa'
  const width = Math.max(800, Math.min(1280, Math.round(workArea.width * 0.85)))
  const height = Math.max(600, Math.min(820, Math.round(workArea.height * 0.8)))
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    show: false,
    title: 'Larify',
    backgroundColor,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(process.platform === 'win32'
      ? {
          icon: resourcePath('icon.png'),
          titleBarOverlay: {
            color: 'rgba(0,0,0,0)',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
            height: titleBarHeight
          }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webviewTag: true
    }
  })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.partition !== BROWSER_PARTITION || params.src !== 'about:blank') {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.backgroundThrottling = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
  })
  window.on('ready-to-show', () => {
    window.maximize()
    window.show()
  })
  const loading =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? window.loadURL(process.env['ELECTRON_RENDERER_URL'])
      : window.loadFile(join(__dirname, '../renderer/index.html'))
  void loading.catch((error) => console.error('Failed to load renderer:', error))
  return window
}
