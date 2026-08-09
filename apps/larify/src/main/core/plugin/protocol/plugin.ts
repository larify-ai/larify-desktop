import type { Disposable } from '../../../infra/disposable'
import type { Registry } from '../../../infra/registry'
import type { Manifest } from './manifest'
import type { Skill } from './skill'
import type { Tool } from './tool'

export interface PluginContext {
  readonly manifest: Manifest
  readonly registry: Registry
  readonly subscriptions: Disposable[]

  registerTool(name: string, tool: Tool): void
  registerSkill(name: string, skill: Skill): void
}

export interface Plugin {
  readonly manifest: Manifest
  activate(context: PluginContext): void | Promise<void>
}
