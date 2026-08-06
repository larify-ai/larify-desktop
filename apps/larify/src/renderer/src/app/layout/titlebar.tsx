import { PanelLeftOpenIcon, PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react'

import { PanelToggle } from './panel-toggle'

interface TitlebarProps {
  navigationCollapsed: boolean
  workbenchCollapsed: boolean
  onToggleNavigation: () => void
  onToggleWorkbench: () => void
}

export function Titlebar({
  navigationCollapsed,
  workbenchCollapsed,
  onToggleNavigation,
  onToggleWorkbench
}: TitlebarProps): React.JSX.Element {
  return (
    <header className="relative flex h-(--titlebar-h) shrink-0 items-center border-b-[0.5px] border-border-strong px-2 [-webkit-app-region:drag]">
      {navigationCollapsed && (
        <PanelToggle label="切换侧边栏" icon={PanelLeftOpenIcon} onClick={onToggleNavigation} />
      )}
      <div
        className="absolute top-1/2 -translate-y-1/2"
        style={{
          right: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))'
        }}
      >
        <PanelToggle
          label="切换工作区"
          icon={workbenchCollapsed ? PanelRightOpenIcon : PanelRightCloseIcon}
          onClick={onToggleWorkbench}
        />
      </div>
    </header>
  )
}
