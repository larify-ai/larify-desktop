import { PanelLeftCloseIcon } from 'lucide-react'

import { PanelToggle } from '../layout/panel-toggle'
import { Region } from '../layout/region'
import { NavigationContent } from './navigation-content'

export function Navigation({
  onCollapse,
  showToggle = true
}: {
  onCollapse: () => void
  showToggle?: boolean
}): React.JSX.Element {
  return (
    <Region label="Navigation" className="h-full bg-sidebar">
      <div
        className="flex h-(--titlebar-h) shrink-0 items-center pr-3 [-webkit-app-region:drag]"
        style={{ paddingLeft: 'calc(var(--titlebar-inset-left) - 6px)' }}
      >
        {showToggle && (
          <PanelToggle label="隐藏侧边栏" icon={PanelLeftCloseIcon} onClick={onCollapse} />
        )}
      </div>
      <NavigationContent />
    </Region>
  )
}
