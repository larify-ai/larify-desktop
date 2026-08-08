import { useState } from 'react'
import { Interaction } from '../interaction/interaction'
import {
  ConversationHeader,
  type ConversationHeading
} from '../interaction/assistant/conversation-header'
import { Navigation } from '../navigation/navigation'
import { Workbench } from '../workbench/workbench'
import { ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable'
import { ResizeHandle } from './resize-handle'
import { expandedContentMinSize, layoutSpec } from './layout-spec'
import { Titlebar } from './titlebar'
import { useGroupToggle } from './use-group-toggle'

const navigationCollapsed = { navigation: 0, content: 100 }
const navigationExpanded = { navigation: 15, content: 85 }
const workbenchCollapsed = { interaction: 100, workbench: 0 }
const workbenchExpanded = { interaction: 64, workbench: 36 }

export function LayoutPanels(): React.JSX.Element {
  const [heading, setHeading] = useState<ConversationHeading | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const navigation = useGroupToggle('navigation', navigationCollapsed, navigationExpanded)
  const workbench = useGroupToggle('workbench', workbenchCollapsed, workbenchExpanded, true)

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
        <Navigation
          onCollapse={navigation.toggle}
          onNewTask={() => {
            setHeading(null)
            setSessionKey((key) => key + 1)
          }}
        />
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
          className="min-h-0 flex-1"
          direction="horizontal"
          groupRef={workbench.groupRef}
        >
          <ResizablePanel id="interaction" minSize={layoutSpec.interaction.minSize}>
            <Interaction sessionKey={sessionKey} onHeadingChange={setHeading} />
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
            <Workbench />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
