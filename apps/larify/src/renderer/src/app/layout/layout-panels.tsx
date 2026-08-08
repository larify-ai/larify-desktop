import { Interaction } from '../interaction/interaction'
import { ConversationHeader } from '../interaction/assistant/conversation-header'
import { Navigation } from '../navigation/navigation'
import { useAssistantSessions } from '../interaction/assistant/sessions-context'
import { Workbench } from '../workbench/workbench'
import { ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable'
import { ResizeHandle } from './resize-handle'
import { expandedContentMinSize, layoutSpec } from './layout-spec'
import { Titlebar } from './titlebar'
import { useGroupToggle } from './use-group-toggle'

const navigationCollapsed = { navigation: 0, content: 100 }
const workbenchCollapsed = { interaction: 100, workbench: 0 }

export function LayoutPanels(): React.JSX.Element {
  const { heading } = useAssistantSessions().activeSession
  const navigation = useGroupToggle('navigation', navigationCollapsed)
  const workbench = useGroupToggle('workbench', workbenchCollapsed, true)

  return (
    <ResizablePanelGroup id="main" direction="horizontal" groupRef={navigation.groupRef}>
      <ResizablePanel
        id="navigation"
        className="!overflow-hidden"
        collapsible={navigation.collapsed}
        collapsedSize={0}
        defaultSize={layoutSpec.navigation.defaultSize}
        minSize={layoutSpec.navigation.minSize}
        maxSize={layoutSpec.navigation.maxSize}
        groupResizeBehavior="preserve-pixel-size"
      >
        <div className="h-full w-full overflow-hidden">
          <Navigation onCollapse={navigation.toggle} showToggle={!navigation.collapsed} />
        </div>
      </ResizablePanel>
      <ResizeHandle label="Resize navigation" hidden={navigation.collapsed} />
      <ResizablePanel
        id="content"
        minSize={workbench.collapsed ? layoutSpec.interaction.minSize : expandedContentMinSize}
        className={`flex h-full min-w-0 flex-col overflow-hidden border-[0.5px] border-border-strong bg-background ${
          navigation.collapsed ? 'rounded-none border-l-0' : 'rounded-l-[12px]'
        }`}
      >
        <Titlebar
          navigationCollapsed={navigation.collapsed}
          workbenchCollapsed={workbench.collapsed}
          onToggleNavigation={navigation.toggle}
          onToggleWorkbench={workbench.toggle}
        >
          {heading && <ConversationHeader cwd={heading.cwd} title={heading.title} />}
        </Titlebar>
        <ResizablePanelGroup
          id="content"
          groupRef={workbench.groupRef}
          className="min-h-0 flex-1"
          direction="horizontal"
        >
          <ResizablePanel id="interaction" minSize={layoutSpec.interaction.minSize}>
            <Interaction />
          </ResizablePanel>
          <ResizeHandle label="Resize workbench" hidden={workbench.collapsed} feedback />
          <ResizablePanel
            id="workbench"
            className="!overflow-hidden"
            collapsible={workbench.collapsed}
            collapsedSize={0}
            defaultSize={layoutSpec.workbench.defaultSize}
            minSize={layoutSpec.workbench.minSize}
            groupResizeBehavior="preserve-pixel-size"
          >
            <div className="h-full w-full overflow-hidden">
              <Workbench />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
