import type { LucideIcon } from 'lucide-react'

interface PanelToggleProps {
  label: string
  icon: LucideIcon
  onClick: () => void
  className?: string
}

export function PanelToggle({
  label,
  icon: Icon,
  onClick,
  className = ''
}: PanelToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-8 items-center justify-center rounded-md [-webkit-app-region:no-drag] hover:bg-sidebar-accent ${className}`}
      onClick={onClick}
    >
      <Icon className="pointer-events-none size-5" />
    </button>
  )
}
