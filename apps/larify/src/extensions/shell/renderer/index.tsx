import type { CSSProperties } from "react"
import type { Extension } from "kernel"
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarInset,
} from "@renderer/components/ui/sidebar"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@renderer/components/ui/resizable"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties

function Shell(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div
        className="h-(--titlebar-h) shrink-0 border-b border-border-strong bg-sidebar"
        style={dragRegion}
      />
      <SidebarProvider
        className="min-h-0 flex-1"
        style={{ "--sidebar-width": "4.5rem" } as CSSProperties}
      >
        <Sidebar collapsible="none" className="border-r border-border-strong">
          <SidebarContent />
        </Sidebar>
        <SidebarInset>
          <ResizablePanelGroup direction="horizontal" className="min-w-0 flex-1">
            <ResizablePanel defaultSize={60} minSize={10} />
            <ResizableHandle />
            <ResizablePanel defaultSize={40} minSize={25} />
          </ResizablePanelGroup>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

const extension: Extension = {
  activate(app) {
    app.register("view", "root", { render: () => <Shell /> })
  },
}

export default extension
