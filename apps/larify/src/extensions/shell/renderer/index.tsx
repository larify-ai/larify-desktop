import { useState, useEffect, type CSSProperties } from "react"
import { ThemeProvider, useTheme } from "next-themes"
import type { Extension } from "kernel"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarInset,
} from "@renderer/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@renderer/components/ui/avatar"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@renderer/components/ui/resizable"
import { SettingsPane } from "./settings/settings-pane"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties

function NativeThemeSync(): null {
  const { theme, resolvedTheme } = useTheme()

  useEffect(() => {
    if (theme === "light" || theme === "dark" || theme === "system") {
      window.bridge?.invoke?.("theme:set", theme)
    }
  }, [theme])

  useEffect(() => {
    window.bridge?.invoke?.("titlebar:set-symbol", resolvedTheme === "light" ? "#0a0a0a" : "#fafafa")
  }, [resolvedTheme])

  return null
}

function Shell(): React.JSX.Element {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <NativeThemeSync />
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <div
          className="h-(--titlebar-h) shrink-0 border-b border-border-strong bg-sidebar"
          style={dragRegion}
        />
        <SidebarProvider
          className="min-h-0 flex-1"
          style={{ "--sidebar-width": "3.5rem" } as CSSProperties}
        >
          <Sidebar collapsible="none" className="border-r border-border-strong">
            <SidebarContent />
            <SidebarFooter className="items-center">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-label="账户"
                    isActive={showSettings}
                    onClick={() => setShowSettings((v) => !v)}
                    className="h-auto justify-center px-1 py-2"
                  >
                    <Avatar className="size-7 shrink-0">
                      <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                        徐
                      </AvatarFallback>
                    </Avatar>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset>
            {showSettings ? (
              <ResizablePanelGroup direction="horizontal" className="min-w-0 flex-1">
                <ResizablePanel defaultSize={68} minSize={10}>
                  <SettingsPane />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={32} minSize={25} />
              </ResizablePanelGroup>
            ) : (
              <div className="min-w-0 flex-1" />
            )}
          </SidebarInset>
        </SidebarProvider>
      </div>
    </ThemeProvider>
  )
}

const extension: Extension = {
  activate(app) {
    app.register("view", "root", { render: () => <Shell /> })
  },
}

export default extension
