import type { ReactNode } from 'react'
import { PanelLeftOpenIcon, PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react'

import { PanelToggle } from './panel-toggle'

interface TitlebarProps {
  children?: ReactNode
  navigationCollapsed: boolean
  workbenchCollapsed: boolean
  onToggleNavigation: () => void
  onToggleWorkbench: () => void
}

export function Titlebar({
  children,
  navigationCollapsed,
  workbenchCollapsed,
  onToggleNavigation,
  onToggleWorkbench
}: TitlebarProps): React.JSX.Element {
  return (
    <header
      className="relative flex h-(--titlebar-h) shrink-0 items-center border-b-[0.5px] border-border-strong px-2 [-webkit-app-region:drag]"
      style={
        navigationCollapsed ? { paddingLeft: 'calc(var(--titlebar-inset-left) - 6px)' } : undefined
      }
    >
      {navigationCollapsed && (
        <PanelToggle label="显示侧边栏" icon={PanelLeftOpenIcon} onClick={onToggleNavigation} />
      )}
      <div
        className="ml-1 min-w-0 flex-1"
        style={{
          paddingRight:
            'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 3rem)'
        }}
      >
        {children}
      </div>
      <div
        className="absolute top-1/2 -translate-y-1/2"
        style={{
          right: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))'
        }}
      >
        <PanelToggle
          label={workbenchCollapsed ? '显示工作台' : '隐藏工作台'}
          icon={workbenchCollapsed ? PanelRightOpenIcon : PanelRightCloseIcon}
          onClick={onToggleWorkbench}
        />
      </div>
    </header>
  )
}
