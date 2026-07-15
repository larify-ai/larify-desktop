import { useState, type CSSProperties } from "react"
import { MessageCirclePlusIcon } from "lucide-react"
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

const labels = {
  newTask: "\u65b0\u5efa\u4efb\u52a1",
  newTaskShort: "\u65b0\u5efa",
  account: "\u8d26\u6237",
}

const sidebarItemClass =
  "mx-auto size-10 justify-center px-0 py-0 [&>svg]:size-6!"

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

  const newTask = (): void => {
    window.dispatchEvent(new Event("agent:new-session"))
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div
        className="relative flex h-(--titlebar-h) shrink-0 items-center border-b border-border-strong bg-sidebar"
        style={dragRegion}
      />
      <SidebarProvider
        className="min-h-0 flex-1"
        style={{ "--sidebar-width": "3rem" } as CSSProperties}
      >
        <Sidebar collapsible="none" className="border-r border-border-strong">
          <SidebarContent className="items-center gap-0 overflow-x-hidden pt-2">
            <SidebarMenu className="items-center gap-2 px-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label={labels.newTask}
                  tooltip={labels.newTask}
                  onClick={newTask}
                  className={sidebarItemClass}
                >
                  <MessageCirclePlusIcon />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="items-center px-1">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label="账户"
                  isActive={workbench === "settings"}
                  onClick={() => setWorkbench((v) => (v === "settings" ? null : "settings"))}
                  className={sidebarItemClass}
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
