import type { Disposable } from '../../infra/disposable'
import type { Registry } from '../../infra/registry'
import type { Manifest, Plugin, PluginContext, Skill, Tool } from './protocol'
import { wrapTool } from './protocol'

interface RegisteredPlugin {
  manifest: Manifest
  subscriptions: Disposable[]
  tools: Map<string, Tool>
  skills: Map<string, Skill>
}

function sortMap<T>(values: Iterable<readonly [string, T]>): Map<string, T> {
  return new Map([...values].sort(([a], [b]) => a.localeCompare(b)))
}

export class PluginHost {
  private readonly plugins = new Map<string, RegisteredPlugin>()

  constructor(private readonly registry: Registry) {}

  has(id: string): boolean {
    return this.plugins.has(id)
  }

  listPlugins(): Manifest[] {
    return [...this.plugins.values()]
      .map(({ manifest }) => manifest)
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  getTools(pluginId: string): ReadonlyMap<string, Tool> | undefined {
    return this.plugins.get(pluginId)?.tools
  }

  getSkills(pluginId: string): ReadonlyMap<string, Skill> | undefined {
    return this.plugins.get(pluginId)?.skills
  }

  async activate(plugin: Plugin): Promise<void> {
    const { id } = plugin.manifest
    if (this.plugins.has(id)) throw new Error(`Plugin already active: ${id}`)

    const registered: RegisteredPlugin = {
      manifest: plugin.manifest,
      subscriptions: [],
      tools: new Map(),
      skills: new Map()
    }
    this.plugins.set(id, registered)
    try {
      await plugin.activate(this.createContext(registered))
      registered.tools = sortMap(registered.tools)
      registered.skills = sortMap(registered.skills)
    } catch (error) {
      if (this.plugins.get(id) === registered) this.plugins.delete(id)
      await this.disposeSubscriptions(registered.subscriptions)
      throw error
    }
  }

  async deactivate(id: string): Promise<void> {
    const registered = this.plugins.get(id)
    if (!registered) return
    this.plugins.delete(id)
    await this.disposeSubscriptions(registered.subscriptions)
  }

  async reload(plugin: Plugin): Promise<void> {
    await this.deactivate(plugin.manifest.id)
    await this.activate(plugin)
  }

  async dispose(): Promise<void> {
    for (const id of [...this.plugins.keys()].reverse()) {
      await this.deactivate(id)
    }
  }

  private createContext(registered: RegisteredPlugin): PluginContext {
    return {
      manifest: registered.manifest,
      registry: this.registry,
      subscriptions: registered.subscriptions,
      registerTool: (name, tool) =>
        registered.tools.set(`${registered.manifest.id}_${name}`, wrapTool(tool)),
      registerSkill: (name, skill) =>
        registered.skills.set(`${registered.manifest.id}_${name}`, skill)
    }
  }

  private async disposeSubscriptions(subscriptions: Disposable[]): Promise<void> {
    for (const subscription of [...subscriptions].reverse()) {
      try {
        await subscription.dispose()
      } catch (error) {
        console.error('[plugin] Failed to dispose subscription:', error)
      }
    }
  }
}
