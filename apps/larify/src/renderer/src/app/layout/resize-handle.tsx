import { ResizableHandle } from '../../components/ui/resizable'

interface ResizeHandleProps {
  label: string
  feedback?: boolean
  hidden?: boolean
}

export function ResizeHandle({
  label,
  feedback = false,
  hidden = false
}: ResizeHandleProps): React.JSX.Element {
  return (
    <ResizableHandle className={`group w-0 ${hidden ? 'invisible' : ''}`} aria-label={label}>
      {feedback && (
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-[0.5px] -translate-x-1/2 bg-border-strong group-hover:bg-foreground/20 group-data-[separator=active]:bg-foreground/20 group-data-[separator=focus]:bg-foreground/20" />
      )}
    </ResizableHandle>
  )
}
