import { GlobeIcon } from 'lucide-react'

export function EmptyState(): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <GlobeIcon className="size-16 opacity-30" />
      <p className="mt-2 text-lg font-medium text-foreground">开始浏览</p>
    </div>
  )
}
