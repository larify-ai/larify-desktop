import { join } from 'node:path'
import { BrowserWindow, nativeTheme, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { resourcePath } from '../utils/app-paths'

export const titleBarHeight = 46

export function createWindow(): BrowserWindow {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(1280, workArea.width - 80)
  const height = Math.min(800, workArea.height - 80)
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    show: false,
    title: 'Larify',
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
      sandbox: true
    }
  })
  window.on('ready-to-show', () => window.show())
  const loading =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? window.loadURL(process.env['ELECTRON_RENDERER_URL'])
      : window.loadFile(join(__dirname, '../renderer/index.html'))
  void loading.catch((error) => console.error('Failed to load renderer:', error))
  return window
}
