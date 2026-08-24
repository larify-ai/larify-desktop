import { SquareCode } from 'lucide-react'

export function EmptyFilePreview(): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <SquareCode aria-hidden className="size-16 opacity-30" />
      <p className="text-lg font-medium text-foreground">打开文件</p>
    </div>
  )
}
