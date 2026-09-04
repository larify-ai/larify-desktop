import { memo, useLayoutEffect, useMemo } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { Interaction } from '../interaction/interaction'
import { ConversationHeader } from '../interaction/assistant/conversation-header'
import { Navigation } from '../navigation/navigation'
import { useAssistantSessions } from '../interaction/assistant/sessions-context'
import { WorkbenchHost } from '../workbench/workbench'

// 折叠侧边栏时只应改变布局，不应触发交互/工作台/导航树的整棵重建。
// memo 让这些子树只在真实依赖（sessions 上下文、activeId、sessions 数组）变化时才重渲染，
// 折叠/展开的 animating 状态变化不再连带重渲染它们。
const MemoInteraction = memo(Interaction)
const MemoWorkbenchHost = memo(WorkbenchHost)
const MemoNavigation = memo(Navigation)
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
  const interaction = useMemo(() => <MemoInteraction />, [])
  const workbenchHost = useMemo(
    () => <MemoWorkbenchHost activeId={activeId} sessions={sessions} />,
    [activeId, sessions]
  )

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
          <MemoNavigation onCollapse={navigation.toggle} showToggle={!navigation.collapsed} />
        </div>
      </Allotment.Pane>
      <Allotment.Pane
        minSize={workbench.collapsed ? layoutSpec.interaction.minSize : expandedContentMinSize}
      >
        <div
          className={`larify-main-surface relative flex h-full min-w-0 flex-col overflow-hidden bg-background ${
            navigation.collapsed ? 'larify-main-surface-navigation-collapsed' : ''
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
            interaction={interaction}
            workbench={workbenchHost}
          />
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}
