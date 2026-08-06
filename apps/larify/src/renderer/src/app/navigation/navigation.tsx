import { PanelLeftCloseIcon } from 'lucide-react'

import { PanelToggle } from '../layout/panel-toggle'
import { Region } from '../layout/region'

export function Navigation({ onCollapse }: { onCollapse: () => void }): React.JSX.Element {
  return (
    <Region label="Navigation" className="h-full bg-sidebar">
      <div className="flex h-(--titlebar-h) shrink-0 items-center px-2 [-webkit-app-region:drag]">
        <PanelToggle label="切换侧边栏" icon={PanelLeftCloseIcon} onClick={onCollapse} />
      </div>
      <nav aria-label="Tasks" className="min-h-0 flex-1" />
    </Region>
  )
}
