import { useEffect } from "react"
import { useTheme } from "next-themes"

export function useNativeThemeSync(): void {
  const { theme, resolvedTheme } = useTheme()

  useEffect(() => {
    if (theme === "light" || theme === "dark" || theme === "system") {
      window.bridge?.invoke?.("theme:set", theme)
    }
  }, [theme])

  useEffect(() => {
    window.bridge?.invoke?.(
      "titlebar:set-symbol",
      resolvedTheme === "light" ? "#0a0a0a" : "#fafafa",
    )
  }, [resolvedTheme])
}
