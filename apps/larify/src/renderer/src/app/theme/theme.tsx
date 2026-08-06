import { useEffect, type ReactNode } from 'react'
import { ThemeProvider as NextThemeProvider, useTheme } from 'next-themes'

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <NativeTheme />
      {children}
    </NextThemeProvider>
  )
}

function NativeTheme(): null {
  const { theme } = useTheme()

  useEffect(() => {
    if (theme) void window.bridge?.invoke('theme:set', theme).catch(() => {})
  }, [theme])

  return null
}
