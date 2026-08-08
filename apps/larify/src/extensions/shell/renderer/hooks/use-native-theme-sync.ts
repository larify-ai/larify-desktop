import { useEffect } from 'react'
import { useTheme } from '@renderer/app/theme/use-theme'

export function useNativeThemeSync(): void {
  const { theme } = useTheme()

  useEffect(() => {
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      void window.bridge.invoke('theme:set', theme).catch(() => {})
    }
  }, [theme])
}
