import { Paintbrush, CircleUser, Info, SlidersHorizontal } from "lucide-react"
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
import { useSettings, type SettingsSection } from "./use-settings"
import { AppearanceSection } from "./sections/appearance-section"
import { AccountSection } from "./sections/account-section"
import { AboutSection } from "./sections/about-section"
import { GeneralSection } from "./sections/general-section"

const NAV: { id: SettingsSection; name: string; icon: typeof Paintbrush }[] = [
  { id: "account", name: "账户", icon: CircleUser },
  { id: "general", name: "通用", icon: SlidersHorizontal },
  { id: "appearance", name: "外观", icon: Paintbrush },
  { id: "about", name: "关于", icon: Info },
]

const SECTIONS: Record<SettingsSection, () => React.JSX.Element> = {
  account: AccountSection,
  general: GeneralSection,
  appearance: AppearanceSection,
  about: AboutSection,
}

export function SettingsPane(): React.JSX.Element {
  const { section, setSection } = useSettings()
  const Current = SECTIONS[section]
  const currentName = NAV.find((n) => n.id === section)?.name

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
                {NAV.map((item) => (
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
          <h2 className="text-sm font-medium">{currentName}</h2>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <Current />
        </div>
      </main>
    </SidebarProvider>
  )
}
