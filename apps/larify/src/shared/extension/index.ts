import type { Service } from "./service"
import type { Skill } from "./skill"
import type { Tool } from "./tool"
import type { View } from "./view"

export { defineService } from "./service"
export type { Service } from "./service"
export type { Skill } from "./skill"
export type { Tool } from "./tool"
export type { View } from "./view"
export { ExtensionHost } from "./host"

export interface Extension {
  name: string
  version?: string
  description: string
  activate(app: App): void | Promise<void>
}

export interface App {
  registerTool(name: string, tool: Tool, eager?: boolean): void
  registerSkill(name: string, skill: Skill, eager?: boolean): void
  registerView<Props>(name: string, view: View<Props>): void
  registerService<T>(name: Service<T>, service: T): void
}
