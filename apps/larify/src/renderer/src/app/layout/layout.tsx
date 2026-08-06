import { Interaction } from '../interaction/interaction'
import { Navigation } from '../navigation/navigation'
import { Workbench } from '../workbench/workbench'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable'

function ResizeHandle({ label, feedback = false }: { label: string; feedback?: boolean }): React.JSX.Element {
  return (
    <ResizableHandle className="group w-0" aria-label={label}>
      {feedback && (
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-[0.5px] -translate-x-1/2 bg-border-strong group-hover:bg-foreground/20 group-data-[separator=active]:bg-foreground/20 group-data-[separator=focus]:bg-foreground/20" />
      )}
    </ResizableHandle>
  )
}

export function Layout(): React.JSX.Element {
  return (
    <main className="h-screen overflow-hidden bg-sidebar text-foreground">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          id="navigation"
          defaultSize={275}
          minSize={240}
          maxSize={520}
          groupResizeBehavior="preserve-pixel-size"
        >
          <Navigation />
        </ResizablePanel>
        <ResizeHandle label="Resize navigation" />
        <ResizablePanel
          id="content"
          minSize={672}
          className="flex h-full min-w-0 flex-col overflow-hidden rounded-l-[12px] border-[0.5px] border-border-strong bg-background"
        >
          <header className="h-(--titlebar-h) shrink-0 border-b-[0.5px] border-border-strong [-webkit-app-region:drag]" />
          <ResizablePanelGroup className="min-h-0 flex-1" direction="horizontal">
            <ResizablePanel id="interaction" defaultSize="64%" minSize={352}>
              <Interaction />
            </ResizablePanel>
            <ResizeHandle label="Resize workbench" feedback />
            <ResizablePanel id="workbench" defaultSize="36%" minSize={320}>
              <Workbench />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  )
}
