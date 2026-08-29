import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type ThemeSource = 'light' | 'dark' | 'system'

const themePath = (): string => join(app.getPath('userData'), 'theme.json')

export function loadTheme(): ThemeSource | undefined {
  try {
    if (!existsSync(themePath())) return undefined
    const value = JSON.parse(readFileSync(themePath(), 'utf8')) as { theme?: unknown }
    return value.theme === 'light' || value.theme === 'dark' || value.theme === 'system'
      ? value.theme
      : undefined
  } catch {
    return undefined
  }
}

export function saveTheme(theme: ThemeSource): void {
  try {
    writeFileSync(themePath(), JSON.stringify({ theme }), 'utf8')
  } catch (error) {
    // 主题偏好持久化失败不应中断 IPC 处理；回退为仅本次生效。
    console.error('[theme] failed to save theme:', error)
  }
}
