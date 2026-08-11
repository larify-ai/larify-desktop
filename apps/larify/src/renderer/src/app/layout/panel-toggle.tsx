import type { LucideIcon } from 'lucide-react'

interface PanelToggleProps {
  label: string
  icon: LucideIcon
  onClick: () => void
}

export function PanelToggle({ label, icon: Icon, onClick }: PanelToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-8 items-center justify-center rounded-md [-webkit-app-region:no-drag] hover:bg-sidebar-accent"
      onClick={onClick}
    >
      <Icon className="pointer-events-none size-[18px]" />
    </button>
  )
}
