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
import { WorkbenchSplit } from './workbench-split'
import {
  flushNativeLayout,
  notifyWorkbenchAnimation,
  workbenchStateRequestEvent
} from './native-layout'
import './layout-panels.css'

function MainSurfaceCorners(): React.JSX.Element {
  return (
    <>
      <span
        aria-hidden="true"
        className="larify-main-surface-corner larify-main-surface-corner-top"
      />
      <span
        aria-hidden="true"
        className="larify-main-surface-corner larify-main-surface-corner-bottom"
      />
    </>
  )
}

export function LayoutPanels(): React.JSX.Element {
  const { activeId, activeSession, sessions } = useAssistantSessions()
  const { heading } = activeSession
  const navigation = useAllotmentToggle()
  const workbench = useAllotmentToggle(true)
  const setWorkbenchCollapsed = workbench.setCollapsed

  useLayoutEffect(() => {
    const showWorkbench = (): void => setWorkbenchCollapsed(false)
    window.addEventListener('larify:workbench-open', showWorkbench)
    return () => window.removeEventListener('larify:workbench-open', showWorkbench)
  }, [setWorkbenchCollapsed])

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
      onDragEnd={() => flushNativeLayout()}
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
          className={`relative flex h-full min-w-0 flex-col overflow-hidden border-[0.5px] border-border-strong bg-background ${
            navigation.collapsed ? 'border-l-0' : ''
          }`}
        >
          {!navigation.collapsed && <MainSurfaceCorners />}
          <Titlebar
            navigationCollapsed={navigation.collapsed}
            workbenchCollapsed={workbench.collapsed}
            onToggleNavigation={navigation.toggle}
            onToggleWorkbench={workbench.toggle}
          >
            {heading && <ConversationHeader cwd={heading.cwd} title={heading.title} />}
          </Titlebar>
          <WorkbenchSplit
            animated={workbench.animating}
            collapsed={workbench.collapsed}
            interaction={<Interaction />}
            workbench={<WorkbenchHost activeId={activeId} sessions={sessions} />}
          />
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}
