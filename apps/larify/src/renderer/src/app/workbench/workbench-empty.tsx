import type { WorkbenchRendererRegistry } from '../registry/workbench-renderers'

interface WorkbenchEmptyProps {
  renderers: WorkbenchRendererRegistry | undefined
  onOpenTool(id: string): void
}

export function WorkbenchEmpty({ renderers, onOpenTool }: WorkbenchEmptyProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 overflow-auto p-6" data-testid="workbench-empty">
      <div className="m-auto flex w-full max-w-xl flex-col items-center gap-5">
        <h2 className="text-xl font-medium text-foreground">打开标签页</h2>
        <div
          aria-label="工作台工具"
          className="grid w-full grid-cols-[repeat(auto-fit,5.5rem)] justify-center gap-3"
          role="group"
        >
          {renderers?.list().map(([id, renderer]) => (
            <button
              className="flex size-22 flex-col items-center justify-center gap-2 rounded-xl bg-accent/50 p-3 text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              key={id}
              type="button"
              onClick={() => onOpenTool(id)}
            >
              <span aria-hidden className="flex size-6 items-center justify-center">
                {renderer.icon}
              </span>
              <span className="max-w-full truncate">{renderer.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
