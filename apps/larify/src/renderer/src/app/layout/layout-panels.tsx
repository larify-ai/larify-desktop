import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { Interaction } from '../interaction/interaction'
import { ConversationHeader } from '../interaction/assistant/conversation-header'
import { Navigation } from '../navigation/navigation'
import { useAssistantSessions } from '../interaction/assistant/sessions-context'
import { Workbench } from '../workbench/workbench'
import { expandedContentMinSize, layoutSpec, mainLayoutDefaultSizes } from './layout-spec'
import { Titlebar } from './titlebar'
import { useAllotmentToggle } from './use-allotment-toggle'
import './layout-panels.css'

const layoutToggleEvent = 'larify:layout-toggle'
const layoutResizeStartEvent = 'larify:layout-resize-start'

export function LayoutPanels(): React.JSX.Element {
  const { heading } = useAssistantSessions().activeSession
  const navigation = useAllotmentToggle()
  const workbench = useAllotmentToggle(true)
  const mainDefaultSizes = mainLayoutDefaultSizes(
    typeof window === 'undefined'
      ? layoutSpec.navigation.defaultSize + layoutSpec.interaction.minSize
      : window.innerWidth
  )
  const notifyLayoutChange = (): void => {
    window.dispatchEvent(new Event(layoutToggleEvent))
  }
  const notifyLayoutResizeStart = (): void => {
    window.dispatchEvent(new Event(layoutResizeStartEvent))
  }
  const toggle = (action: () => void): void => {
    action()
    notifyLayoutChange()
  }

  return (
    <Allotment
      className="larify-allotment"
      defaultSizes={mainDefaultSizes}
      id="main"
      proportionalLayout={false}
      onDragStart={notifyLayoutResizeStart}
      onDragEnd={notifyLayoutChange}
    >
      <Allotment.Pane
        maxSize={layoutSpec.navigation.maxSize}
        minSize={layoutSpec.navigation.minSize}
        preferredSize={layoutSpec.navigation.defaultSize}
        visible={!navigation.collapsed}
      >
        <div className="h-full w-full overflow-hidden [contain:layout_paint]">
          <Navigation
            onCollapse={() => toggle(navigation.toggle)}
            showToggle={!navigation.collapsed}
          />
        </div>
      </Allotment.Pane>
      <Allotment.Pane
        minSize={workbench.collapsed ? layoutSpec.interaction.minSize : expandedContentMinSize}
      >
        <div
          className={`flex h-full min-w-0 flex-col overflow-hidden border-[0.5px] border-border-strong bg-background ${
            navigation.collapsed ? 'rounded-none border-l-0' : 'rounded-l-[12px]'
          }`}
        >
          <Titlebar
            navigationCollapsed={navigation.collapsed}
            workbenchCollapsed={workbench.collapsed}
            onToggleNavigation={() => toggle(navigation.toggle)}
            onToggleWorkbench={() => toggle(workbench.toggle)}
          >
            {heading && <ConversationHeader cwd={heading.cwd} title={heading.title} />}
          </Titlebar>
          <Allotment
            className="larify-allotment larify-workbench-allotment min-h-0 flex-1"
            id="content"
            proportionalLayout={false}
            onDragStart={notifyLayoutResizeStart}
            onDragEnd={notifyLayoutChange}
          >
            <Allotment.Pane minSize={layoutSpec.interaction.minSize}>
              <div className="h-full w-full overflow-hidden [contain:layout_paint]">
                <Interaction />
              </div>
            </Allotment.Pane>
            <Allotment.Pane
              minSize={layoutSpec.workbench.minSize}
              preferredSize={layoutSpec.workbench.defaultSize}
              visible={!workbench.collapsed}
            >
              <div className="h-full w-full overflow-hidden [contain:layout_paint]">
                <Workbench />
              </div>
            </Allotment.Pane>
          </Allotment>
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}
