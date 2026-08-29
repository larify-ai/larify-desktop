import { ipcMain, nativeTheme } from 'electron'
import { titleBarHeight } from '../window'
import type { Application } from '../app/application'
import { saveTheme, type ThemeSource } from './store'

const channel = 'theme:set'

export function registerThemeIpc(application: Application): () => void {
  const syncTitleBar = (): void => {
    const window = application.window.get()
    if (process.platform !== 'win32' || window.isDestroyed()) return
    window.setTitleBarOverlay({
      color: 'rgba(0,0,0,0)',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
      height: titleBarHeight
    })
  }

  ipcMain.handle(channel, (_event, theme) => {
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      nativeTheme.themeSource = theme
      saveTheme(theme as ThemeSource)
    }
  })
  nativeTheme.on('updated', syncTitleBar)

  return () => {
    nativeTheme.removeListener('updated', syncTitleBar)
    ipcMain.removeHandler(channel)
  }
}
