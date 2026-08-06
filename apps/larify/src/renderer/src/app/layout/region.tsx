import type { ReactNode } from 'react'

interface RegionProps {
  children: ReactNode
  className?: string
  header?: ReactNode
  label: string
}

export function Region({
  children,
  className = '',
  header,
  label
}: RegionProps): React.JSX.Element {
  return (
    <section aria-label={label} className={`flex min-w-0 flex-col overflow-hidden ${className}`}>
      {header !== undefined && (
        <header className="flex h-(--titlebar-h) shrink-0 items-center [-webkit-app-region:drag]">
          {header}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  )
}
