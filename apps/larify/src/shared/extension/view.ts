import type { ComponentType } from "react"

export interface View<Props = Record<string, never>> {
  component: ComponentType<Props>
}
