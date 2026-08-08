import type { ReactNode } from 'react'

interface RegionProps {
  children: ReactNode
  className?: string
  label: string
}

export function Region({ children, className = '', label }: RegionProps): React.JSX.Element {
  return (
    <section aria-label={label} className={`flex min-w-0 flex-col overflow-hidden ${className}`}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  )
}
