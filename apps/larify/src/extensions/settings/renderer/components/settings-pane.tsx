import { Paintbrush, CircleUser, Info, SlidersHorizontal, type LucideIcon } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@renderer/components/ui/sidebar"
import { useSettings, type SettingsSection } from "../hooks/use-settings"
import { AppearanceSection } from "./appearance-section"
import { AccountSection } from "./account-section"
import { AboutSection } from "./about-section"
import { GeneralSection } from "./general-section"

const SECTIONS: {
  id: SettingsSection
  name: string
  icon: LucideIcon
  Component: () => React.JSX.Element
}[] = [
  { id: "account", name: "账户", icon: CircleUser, Component: AccountSection },
  { id: "general", name: "通用", icon: SlidersHorizontal, Component: GeneralSection },
  { id: "appearance", name: "外观", icon: Paintbrush, Component: AppearanceSection },
  { id: "about", name: "关于", icon: Info, Component: AboutSection },
]

export function SettingsPane(): React.JSX.Element {
  const { section, setSection } = useSettings()
  const current = SECTIONS.find((s) => s.id === section)
  const Current = current?.Component

  return (
    <SidebarProvider
      className="h-full min-h-0 items-start"
      style={{ "--sidebar-width": "9rem" } as React.CSSProperties}
    >
      <Sidebar collapsible="none" className="hidden md:flex">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {SECTIONS.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={item.id === section}
                      onClick={() => setSection(item.id)}
                    >
                      <item.icon />
                      <span>{item.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b px-6">
          <h2 className="text-sm font-medium">{current?.name}</h2>
        </header>
        <div className="flex-1 overflow-y-auto p-6">{Current && <Current />}</div>
      </main>
    </SidebarProvider>
  )
}
