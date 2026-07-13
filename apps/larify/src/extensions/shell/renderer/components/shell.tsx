import { useState, type CSSProperties } from "react"
import { ThemeProvider } from "next-themes"
import type { App } from "kernel"
import type { View } from "@renderer/types/view"
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
import { useNativeThemeSync } from "../hooks/use-native-theme-sync"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties

export function Shell({ app }: { app: App }): React.JSX.Element {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ShellBody app={app} />
    </ThemeProvider>
  )
}

function ShellBody({ app }: { app: App }): React.JSX.Element {
  const [workbench, setWorkbench] = useState<string | null>(null)
  useNativeThemeSync()

  return (
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
                  isActive={workbench === "settings"}
                  onClick={() => setWorkbench((v) => (v === "settings" ? null : "settings"))}
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
          <ResizablePanelGroup direction="horizontal" className="min-w-0 flex-1">
            {workbench && (
              <ResizablePanel
                key="workbench"
                id="workbench"
                order={1}
                defaultSize={68}
                minSize={1}
                collapsible
                collapsedSize={0}
                onCollapse={() => setWorkbench(null)}
              >
                {app.get<View>("view", workbench)?.render()}
              </ResizablePanel>
            )}
            {workbench && <ResizableHandle key="handle" />}
            <ResizablePanel key="assistant" id="assistant" order={2} minSize={25}>
              {app.get<View>("view", "assistant")?.render()}
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
