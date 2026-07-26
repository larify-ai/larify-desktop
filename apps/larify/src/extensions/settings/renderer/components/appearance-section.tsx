import { useTheme } from 'next-themes'
import { cn } from '@renderer/lib/utils'

const THEMES = [
  { value: 'system', label: '系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

function Mockup({ theme }: { theme: 'dark' | 'light' }): React.JSX.Element {
  return (
    <div className={cn(theme, 'flex h-full w-full gap-2 bg-background p-2.5')}>
      <div className="flex w-6 shrink-0 flex-col items-center gap-2 rounded-lg bg-(--workbench-chrome) py-2.5">
        <div className="size-2.5 rounded-md bg-primary" />
        <div className="size-2.5 rounded-md bg-muted-foreground" />
        <div className="size-2.5 rounded-md bg-muted-foreground" />
      </div>
      <div className="flex flex-1 flex-col justify-between gap-2 rounded-lg border border-border-strong bg-card p-2.5">
        <div className="space-y-1.5">
          <div className="ml-auto h-2 w-2/3 rounded-full bg-muted-foreground" />
          <div className="h-2 w-3/4 rounded-full bg-muted" />
          <div className="ml-auto h-2 w-1/2 rounded-full bg-muted-foreground" />
        </div>
        <div className="h-5 w-full rounded-md bg-muted" />
      </div>
    </div>
  )
}

function SystemMockup(): React.JSX.Element {
  return (
    <div className="relative h-full w-full">
      <Mockup theme="light" />
      <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 50%)' }}>
        <Mockup theme="dark" />
      </div>
    </div>
  )
}

export function AppearanceSection(): React.JSX.Element {
  const { theme, setTheme } = useTheme()
  const selectedTheme = theme ?? 'system'

  return (
    <section>
      <div
        role="radiogroup"
        aria-label="主题"
        className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4"
      >
        {THEMES.map((item) => (
          <label key={item.value} className="flex cursor-pointer flex-col items-center gap-2">
            <input
              type="radio"
              name="theme"
              value={item.value}
              checked={selectedTheme === item.value}
              onChange={() => setTheme(item.value)}
              className="peer sr-only"
            />
            <div
              className={cn(
                'h-40 w-full overflow-hidden rounded-lg border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                selectedTheme === item.value ? 'border-primary' : 'border-border'
              )}
            >
              {item.value === 'system' ? <SystemMockup /> : <Mockup theme={item.value} />}
            </div>
            <span
              className={cn(
                'text-xs',
                selectedTheme === item.value
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {item.label}
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}
