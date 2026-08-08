import type { LucideIcon } from 'lucide-react'

export const navigationItemClassName =
  'mx-1 grid min-w-0 w-[calc(100%-0.5rem)] grid-cols-[20px_minmax(0,1fr)] items-center justify-items-start gap-1 overflow-hidden rounded-lg px-2 text-left text-sm text-foreground hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:outline-none'

interface NavigationActionProps {
  icon: LucideIcon
  children: string
  iconClassName?: string
  onClick?: () => void
}

export function NavigationAction({
  icon: Icon,
  children,
  iconClassName = 'size-[18px]',
  onClick
}: NavigationActionProps): React.JSX.Element {
  return (
    <button type="button" className={`${navigationItemClassName} h-8`} onClick={onClick}>
      <Icon aria-hidden="true" className={`${iconClassName} shrink-0`} />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}
