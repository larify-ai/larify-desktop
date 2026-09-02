import type { Disposable } from '@shared/infra/disposable'
import type { Registry } from '@shared/infra/registry'
import type { Manifest, Plugin, PluginContext, Skill, Tool } from './protocol'
import { wrapTool } from './protocol'
import type { SkillDiscovery } from './skill-discovery'
import type { DiscoveredPlugin } from './plugin-discovery'

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
  private readonly pluginFingerprints = new Map<string, string>()

  constructor(
    private readonly registry: Registry,
    private readonly skillDiscovery?: SkillDiscovery
  ) { }

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

  refreshSkills(): void {
    for (const [id, registered] of this.plugins) {
      registered.skills = sortMap(
        (this.skillDiscovery?.discover(id) ?? []).map((skill) => [`${id}_${skill.name}`, skill])
      )
    }
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

  async refreshPlugins(discovered: DiscoveredPlugin[]): Promise<void> {
    const seen = new Set<string>()
    for (const { plugin, fingerprint } of discovered) {
      const id = plugin.manifest.id
      seen.add(id)
      if (!this.plugins.has(id)) {
        await this.syncDiskPlugin(id, fingerprint, 'activate', () => this.activate(plugin))
      } else if (this.pluginFingerprints.has(id) && this.pluginFingerprints.get(id) !== fingerprint) {
        await this.syncDiskPlugin(id, fingerprint, 'reload', () => this.reload(plugin))
      }
    }
    for (const id of [...this.pluginFingerprints.keys()]) {
      if (!seen.has(id)) {
        await this.deactivate(id)
        this.pluginFingerprints.delete(id)
      }
    }
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
        registered.tools.set(`${registered.manifest.id}_${name}`, wrapTool(tool))
    }
  }

  private async syncDiskPlugin(
    id: string,
    fingerprint: string,
    action: 'activate' | 'reload',
    run: () => Promise<void>
  ): Promise<void> {
    try {
      await run()
      this.pluginFingerprints.set(id, fingerprint)
    } catch (error) {
      console.error(`[plugin] Failed to ${action} disk plugin "${id}":`, error)
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
