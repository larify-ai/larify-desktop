import { useLayoutEffect } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { Interaction } from '../interaction/interaction'
import { ConversationHeader } from '../interaction/assistant/conversation-header'
import { Navigation } from '../navigation/navigation'
import { useAssistantSessions } from '../interaction/assistant/sessions-context'
import { WorkbenchHost } from '../workbench/workbench'
import { expandedContentMinSize, layoutSpec, mainLayoutDefaultSizes } from './layout-spec'
import { Titlebar } from './titlebar'
import { useAllotmentToggle } from './use-allotment-toggle'
import {
  notifyNativeLayout,
  notifyWorkbenchAnimation,
  workbenchStateRequestEvent
} from './native-layout'
import './layout-panels.css'

export function LayoutPanels(): React.JSX.Element {
  const { activeId, activeSession, sessions } = useAssistantSessions()
  const { heading } = activeSession
  const navigation = useAllotmentToggle()
  const workbench = useAllotmentToggle(true)

  useLayoutEffect(() => {
    const sendWorkbenchState = (): void => {
      notifyWorkbenchAnimation({
        animating: workbench.animating,
        visible: !workbench.collapsed
      })
    }
    sendWorkbenchState()
    window.addEventListener(workbenchStateRequestEvent, sendWorkbenchState)
    return () => window.removeEventListener(workbenchStateRequestEvent, sendWorkbenchState)
  }, [workbench.animating, workbench.collapsed])

  const mainDefaultSizes = mainLayoutDefaultSizes(
    typeof window === 'undefined'
      ? layoutSpec.navigation.defaultSize + layoutSpec.interaction.minSize
      : window.innerWidth
  )
  return (
    <Allotment
      className={`larify-allotment${navigation.animating ? ' larify-allotment-animated' : ''}`}
      defaultSizes={mainDefaultSizes}
      id="main"
      onChange={notifyNativeLayout}
      proportionalLayout={false}
    >
      <Allotment.Pane
        maxSize={layoutSpec.navigation.maxSize}
        minSize={layoutSpec.navigation.minSize}
        preferredSize={layoutSpec.navigation.defaultSize}
        visible={!navigation.collapsed}
      >
        <div
          className="h-full w-full overflow-hidden [contain:layout_paint]"
          style={{ minWidth: layoutSpec.navigation.minSize }}
        >
          <Navigation onCollapse={navigation.toggle} showToggle={!navigation.collapsed} />
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
            onToggleNavigation={navigation.toggle}
            onToggleWorkbench={workbench.toggle}
          >
            {heading && <ConversationHeader cwd={heading.cwd} title={heading.title} />}
          </Titlebar>
          <Allotment
            className={`larify-allotment larify-workbench-allotment min-h-0 flex-1${
              workbench.animating ? ' larify-allotment-animated' : ''
            }`}
            id="content"
            onChange={notifyNativeLayout}
            onVisibleChange={(index, visible) => {
              if (index === 1) workbench.setCollapsed(!visible)
            }}
            proportionalLayout={false}
          >
            <Allotment.Pane minSize={layoutSpec.interaction.minSize}>
              <div className="h-full w-full overflow-hidden [contain:layout_paint]">
                <Interaction />
              </div>
            </Allotment.Pane>
            <Allotment.Pane
              minSize={layoutSpec.workbench.minSize}
              preferredSize={layoutSpec.workbench.defaultSize}
              snap
              visible={!workbench.collapsed}
            >
              <div
                className="h-full w-full overflow-hidden [contain:layout_paint]"
                style={{ minWidth: layoutSpec.workbench.minSize }}
              >
                <WorkbenchHost activeId={activeId} sessions={sessions} />
              </div>
            </Allotment.Pane>
          </Allotment>
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}
