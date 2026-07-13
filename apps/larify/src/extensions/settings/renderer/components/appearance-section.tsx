import { useTheme } from "next-themes"
import { cn } from "@renderer/lib/utils"

function Mockup({ dark }: { dark: boolean }): React.JSX.Element {
  const bg = dark ? "bg-neutral-900" : "bg-neutral-100"
  const rail = dark ? "bg-neutral-800" : "bg-white"
  const dot = dark ? "bg-neutral-600" : "bg-neutral-300"
  const panel = dark ? "bg-neutral-800" : "bg-white"
  const border = dark ? "border-neutral-700" : "border-neutral-200"
  const asst = dark ? "bg-neutral-700" : "bg-neutral-200"
  const user = dark ? "bg-neutral-600" : "bg-neutral-300"
  const input = dark ? "bg-neutral-700/60" : "bg-neutral-100"
  return (
    <div className={cn("flex h-full w-full gap-2 p-2.5", bg)}>
      <div className={cn("flex w-6 shrink-0 flex-col items-center gap-2 rounded-lg py-2.5", rail)}>
        <div className="size-2.5 rounded-md bg-blue-500" />
        <div className={cn("size-2.5 rounded-md", dot)} />
        <div className={cn("size-2.5 rounded-md", dot)} />
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col justify-between gap-2 rounded-lg border p-2.5",
          panel,
          border,
        )}
      >
        <div className="space-y-1.5">
          <div className={cn("ml-auto h-2 w-2/3 rounded-full", user)} />
          <div className={cn("h-2 w-3/4 rounded-full", asst)} />
          <div className={cn("ml-auto h-2 w-1/2 rounded-full", user)} />
        </div>
        <div className={cn("h-5 w-full rounded-md", input)} />
      </div>
    </div>
  )
}

function SystemMockup(): React.JSX.Element {
  return (
    <div className="relative h-full w-full">
      <Mockup dark={false} />
      <div className="absolute inset-0" style={{ clipPath: "inset(0 0 0 50%)" }}>
        <Mockup dark />
      </div>
    </div>
  )
}

export function AppearanceSection(): React.JSX.Element {
  const { theme, setTheme } = useTheme()
  const cards = [
    { value: "system", label: "系统" },
    { value: "light", label: "浅色" },
    { value: "dark", label: "深色" },
  ]
  return (
    <section>
      <div className="grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setTheme(c.value)}
            className="flex flex-col items-center gap-2"
          >
            <div
              className={cn(
                "h-40 w-full overflow-hidden rounded-lg border-2 transition-colors",
                theme === c.value ? "border-primary" : "border-border",
              )}
            >
              {c.value === "system" ? <SystemMockup /> : <Mockup dark={c.value === "dark"} />}
            </div>
            <span
              className={cn(
                "text-xs",
                theme === c.value ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {c.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
