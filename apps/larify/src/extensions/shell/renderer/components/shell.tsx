import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { MessageCirclePlusIcon } from "lucide-react"
import { ThemeProvider } from "next-themes"
import type { ImperativePanelHandle } from "react-resizable-panels"
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
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@renderer/components/ui/resizable"
import { useNativeThemeSync } from "../hooks/use-native-theme-sync"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties

const NEW_TASK_LABEL = "新建"

const DEFAULT_WORKBENCH_SIZE = 55
const MIN_WORKBENCH_SIZE = 20
const MIN_ASSISTANT_SIZE = 35

const sidebarItemClass =
  "grid size-10 place-items-center gap-0 p-0 text-center [&>svg]:size-6! [&>svg]:shrink-0"
const sidebarMenuClass = "w-full items-center gap-0 px-1"

export function Shell({ app }: { app: App }): React.JSX.Element {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ShellBody app={app} />
    </ThemeProvider>
  )
}

function ShellBody({ app }: { app: App }): React.JSX.Element {
  const [workbench, setWorkbench] = useState<string | null>(null)
  const [mountedWorkbenches, setMountedWorkbenches] = useState<string[]>([])
  const workbenchPanelRef = useRef<ImperativePanelHandle>(null)
  const closingWorkbenchRef = useRef(false)
  useNativeThemeSync()

  const sidebarViews = app
    .getAll<View>("view")
    .filter((view) => view.sidebar)
    .sort((a, b) => (a.sidebar?.order ?? 0) - (b.sidebar?.order ?? 0))
  const headerViews = sidebarViews.filter((view) => view.sidebar?.placement === "header")
  const contentViews = sidebarViews.filter(
    (view) => !view.sidebar?.placement || view.sidebar.placement === "content",
  )
  const footerViews = sidebarViews.filter((view) => view.sidebar?.placement === "footer")

  const newTask = (): void => {
    window.dispatchEvent(new Event("agent:new-session"))
  }

  const toggleWorkbench = (id: string): void => {
    setWorkbench((current) => {
      closingWorkbenchRef.current = current === id
      return current === id ? null : id
    })
    setMountedWorkbenches((current) => (current.includes(id) ? current : [...current, id]))
  }

  useLayoutEffect(() => {
    const panel = workbenchPanelRef.current
    if (!panel) return
    if (workbench) panel.expand()
    else {
      closingWorkbenchRef.current = true
      panel.collapse()
    }
  }, [workbench])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: workbench }))
  }, [workbench])

  useEffect(() => {
    const sendActiveWorkbench = (): void => {
      window.dispatchEvent(new CustomEvent("larify:workbench-active", { detail: workbench }))
    }
    window.addEventListener("larify:workbench-active-request", sendActiveWorkbench)
    return () => window.removeEventListener("larify:workbench-active-request", sendActiveWorkbench)
  }, [workbench])

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
        <Sidebar collapsible="none" className="shadow-[inset_-1px_0_0_var(--color-border-strong)]">
          <SidebarContent className="items-center gap-0 overflow-x-hidden overflow-y-auto pt-2">
            <SidebarMenu className={sidebarMenuClass}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label={NEW_TASK_LABEL}
                  tooltip={NEW_TASK_LABEL}
                  onClick={newTask}
                  className={sidebarItemClass}
                >
                  <MessageCirclePlusIcon />
                </SidebarMenuButton>
              </SidebarMenuItem>
              {headerViews.map((view) => (
                <ViewSidebarButton
                  key={view.sidebar?.id}
                  view={view}
                  active={workbench === view.sidebar?.id}
                  onClick={() => toggleWorkbench(view.sidebar!.id)}
                />
              ))}
            </SidebarMenu>
            <SidebarMenu className={sidebarMenuClass}>
              {contentViews.map((view) => (
                <ViewSidebarButton
                  key={view.sidebar?.id}
                  view={view}
                  active={workbench === view.sidebar?.id}
                  onClick={() => toggleWorkbench(view.sidebar!.id)}
                />
              ))}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="items-center px-0">
            <SidebarMenu className={sidebarMenuClass}>
              {footerViews.map((view) => (
                <ViewSidebarButton
                  key={view.sidebar?.id}
                  view={view}
                  active={workbench === view.sidebar?.id}
                  onClick={() => toggleWorkbench(view.sidebar!.id)}
                />
              ))}
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="bg-background">
          <ResizablePanelGroup direction="horizontal" className="min-w-0 flex-1">
            <ResizablePanel
              ref={workbenchPanelRef}
              id="workbench"
              order={1}
              defaultSize={DEFAULT_WORKBENCH_SIZE}
              minSize={MIN_WORKBENCH_SIZE}
              collapsible
              collapsedSize={0}
              onCollapse={() => {
                if (closingWorkbenchRef.current) {
                  closingWorkbenchRef.current = false
                  setWorkbench(null)
                  return
                }
                requestAnimationFrame(() => {
                  workbenchPanelRef.current?.resize(MIN_WORKBENCH_SIZE)
                })
              }}
            >
              <div className="relative h-full w-full overflow-hidden">
                {sidebarViews
                  .filter((view) => mountedWorkbenches.includes(view.sidebar!.id))
                  .map((view) => {
                    const id = view.sidebar!.id
                    return (
                      <div key={id} className={workbench === id ? "absolute inset-0" : "hidden"}>
                        {view.render()}
                      </div>
                    )
                  })}
              </div>
            </ResizablePanel>
            <ResizableHandle
              key="handle"
              className={workbench ? undefined : "pointer-events-none opacity-0"}
            />
            <ResizablePanel key="assistant" id="assistant" order={2} minSize={MIN_ASSISTANT_SIZE}>
              {app.get<View>("view", "assistant")?.render()}
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

function ViewSidebarButton({
  active,
  onClick,
  view,
}: {
  active: boolean
  onClick: () => void
  view: View
}): React.JSX.Element | null {
  if (!view.sidebar) return null
  const Icon = view.sidebar.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-label={view.sidebar.label}
        tooltip={view.sidebar.label}
        isActive={active}
        onClick={onClick}
        className={sidebarItemClass}
      >
        <Icon />
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
