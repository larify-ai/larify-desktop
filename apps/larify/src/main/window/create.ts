import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { BROWSER_PARTITION } from '../../extensions/browser/shared/types'
import { resourcePath } from '../utils/app-paths'
import { loadTheme } from '../theme/store'

export const titleBarHeight = 46

/**
 * 渲染层导航白名单判定（纯函数便于单测）：
 * - dev：仅放行 dev server 同 origin（origin 精确匹配，防「localhost:5173.evil.com」前缀碰撞）。
 * - 生产：仅放行 renderer 目录下的 file:// 导航（目录边界 '/'，防「…/renderer-evil」前缀碰撞）。
 * - 非法 URL 解析不成 → 一律拦截。
 */
export function isRendererNavigation(
  url: string,
  rendererUrl: URL | undefined,
  rendererFilePrefix: string
): boolean {
  try {
    return rendererUrl
      ? new URL(url).origin === rendererUrl.origin
      : url === rendererFilePrefix || url.startsWith(`${rendererFilePrefix}/`)
  } catch {
    return false
  }
}

export function createWindow(): BrowserWindow {
  const savedTheme = loadTheme()
  if (savedTheme) nativeTheme.themeSource = savedTheme
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1e1e1f' : '#fafafa'
  const width = Math.max(856, Math.min(1280, Math.round(workArea.width * 0.85)))
  const height = Math.max(600, Math.min(820, Math.round(workArea.height * 0.8)))
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 856,
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
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://larify.ai/')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  // 渲染层任何未被 preventDefault 的 <a> 默认导航（如 markdown 链接漏拦截）
  // 都会让主窗口整页导航离开应用 → 白屏。此处兜底：只允许应用自身地址，
  // 其余一律阻止（markdown 链接统一走内部 handler，不依赖浏览器导航）。
  // 注意用 origin/目录前缀精确匹配，避免「http://localhost:5173.evil.com」
  // 这类域名前缀碰撞绕过；生产仅放行 renderer 目录下的 file:// 导航。
  const rendererUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? new URL(process.env['ELECTRON_RENDERER_URL'])
      : undefined
  const rendererFilePrefix = pathToFileURL(join(__dirname, '../renderer')).href
  window.webContents.on('will-navigate', (event, url) => {
    if (!isRendererNavigation(url, rendererUrl, rendererFilePrefix)) {
      event.preventDefault()
    }
  })
  const loading =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? window.loadURL(process.env['ELECTRON_RENDERER_URL'])
      : window.loadFile(join(__dirname, '../renderer/index.html'))
  window.on('ready-to-show', () => {
    // 修复多显示器混合 DPI 下窗口过小：在 Windows 上，当屏幕同时存在不同缩放
    // （主屏 200%、副屏 100%）时，new BrowserWindow 的 width/height 会被按主屏 DPI
    // 换算，导致窗口落在低缩放副屏上时物理尺寸被缩小一半。这里在显示前用
    // setSize 以目标 DIP 尺寸矫正，保证任意显示器上窗口都显示正确大小。
    if (process.platform === 'win32') {
      window.setSize(width, height)
    }
    window.show()
  })
  void loading.catch((error) => console.error('Failed to load renderer:', error))
  return window
}
