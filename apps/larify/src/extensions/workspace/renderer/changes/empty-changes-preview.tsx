import { ChangesIcon } from './changes-icon'

export function EmptyChangesPreview(): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <ChangesIcon aria-hidden className="size-16 opacity-30" />
      <p className="text-lg font-medium text-foreground">审查变更</p>
    </div>
  )
}
