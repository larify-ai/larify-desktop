import { useState, type ComponentType } from 'react'
import { Paintbrush, CircleUser, Info, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { AppearanceSection } from './appearance-section'
import { AccountSection } from './account-section'
import { AboutSection } from './about-section'
import { GeneralSection } from './general-section'

const SECTIONS = [
  { id: 'account', name: '账户', icon: CircleUser, Component: AccountSection },
  { id: 'general', name: '通用', icon: SlidersHorizontal, Component: GeneralSection },
  { id: 'appearance', name: '外观', icon: Paintbrush, Component: AppearanceSection },
  { id: 'about', name: '关于', icon: Info, Component: AboutSection }
] as const satisfies readonly {
  id: string
  name: string
  icon: LucideIcon
  Component: ComponentType
}[]

type SettingsSection = (typeof SECTIONS)[number]['id']

export function SettingsPane(): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('account')
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]
  const Current = current.Component

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="w-36 shrink-0 bg-workbench-chrome">
        <nav aria-label="设置" className="p-2">
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((item) => {
              const selected = item.id === section
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={selected ? 'page' : undefined}
                    onClick={() => setSection(item.id)}
                    className={cn(
                      'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors',
                      'hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                      selected && 'bg-sidebar-accent text-sidebar-accent-foreground'
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span>{item.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-workbench-content">
        <header className="flex h-14 shrink-0 items-center border-b px-6">
          <h2 className="text-sm font-medium">{current.name}</h2>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <Current />
        </div>
      </main>
    </div>
  )
}
