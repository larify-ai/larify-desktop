import type { ComponentType, ReactNode, SVGProps } from "react"

export type ViewSidebarIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface ViewSidebarItem {
  icon: ViewSidebarIcon
  id: string
  label: string
  order?: number
  placement?: "header" | "content" | "footer"
}

export interface View {
  sidebar?: ViewSidebarItem
  render(): ReactNode
}
