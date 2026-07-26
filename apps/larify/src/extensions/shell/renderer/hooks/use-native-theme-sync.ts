import { useEffect } from 'react'
import { useTheme } from 'next-themes'

export function useNativeThemeSync(): void {
  const { theme, resolvedTheme } = useTheme()

  useEffect(() => {
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      void window.bridge.invoke('theme:set', theme).catch(() => {})
    }
  }, [theme])

  useEffect(() => {
    const foreground = getComputedStyle(document.documentElement)
      .getPropertyValue('--foreground')
      .trim()
    if (foreground) {
      void window.bridge.invoke('titlebar:set-symbol', foreground).catch(() => {})
    }
  }, [resolvedTheme])
}
