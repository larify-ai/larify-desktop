import { PanelLeftCloseIcon } from 'lucide-react'

import { PanelToggle } from '../layout/panel-toggle'
import { Region } from '../layout/region'
import { NavigationContent } from './navigation-content'

export function Navigation({ onCollapse }: { onCollapse: () => void }): React.JSX.Element {
  return (
    <Region label="Navigation" className="h-full bg-sidebar">
      <div className="flex h-(--titlebar-h) shrink-0 items-center px-3 [-webkit-app-region:drag]">
        <PanelToggle
          label="切换侧边栏"
          icon={PanelLeftCloseIcon}
          onClick={onCollapse}
          className="justify-start"
        />
      </div>
      <NavigationContent />
    </Region>
  )
}
