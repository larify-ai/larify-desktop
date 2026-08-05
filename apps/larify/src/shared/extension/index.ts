import type { Service } from './service'
import type { Skill } from './skill'
import type { Tool } from './tool'
import type { View } from './view'

export type { Metadata } from './metadata'
export { defineService } from './service'
export type { Service } from './service'
export type { Skill } from './skill'
export { defineTool, toolContextSchema } from './tool'
export type { Tool, ToolContext, ToolRunContext } from './tool'
export type { View } from './view'
export { ExtensionHost } from './host'
export {
  BuiltinExtensionSource,
  builtinExtensionSource,
  builtinModules,
  discoverExtensions
} from './discovery'
export type { ExtensionLoader, ExtensionSource } from './discovery'

export interface Extension {
  name: string
  version?: string
  description: string
  activate(app: App): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export interface App {
  registerTool(name: string, tool: Tool): void
  registerSkill(name: string, skill: Skill): void
  registerView<Props>(name: string, view: View<Props>): void
  registerService<T>(name: Service<T>, service: T): void
}
