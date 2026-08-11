import type { Disposable } from '@shared/infra/disposable'
import { defineService, type Registry } from '@shared/infra/registry'

export interface RendererPlugin {
  id: string
  activate(context: RendererPluginContext): void
}

interface RendererPluginContext {
  registry: Registry
  subscriptions: Disposable[]
}

export const rendererPluginHostToken = defineService()

export class RendererPluginHost implements Disposable {
  private readonly plugins = new Map<string, Disposable[]>()

  constructor(private readonly registry: Registry) {}

  activate(plugin: RendererPlugin): void {
    if (this.plugins.has(plugin.id)) throw new Error(`Renderer plugin already active: ${plugin.id}`)
    const subscriptions: Disposable[] = []
    this.plugins.set(plugin.id, subscriptions)
    try {
      plugin.activate({ registry: this.registry, subscriptions })
    } catch (error) {
      this.plugins.delete(plugin.id)
      this.rollbackSubscriptions(subscriptions)
      throw error
    }
  }

  async deactivate(id: string): Promise<void> {
    const subscriptions = this.plugins.get(id)
    if (!subscriptions) return
    this.plugins.delete(id)
    await this.disposeSubscriptions(subscriptions)
  }

  async dispose(): Promise<void> {
    for (const id of [...this.plugins.keys()].reverse()) await this.deactivate(id)
  }

  private async disposeSubscriptions(subscriptions: Disposable[]): Promise<void> {
    for (const subscription of [...subscriptions].reverse()) {
      try {
        await subscription.dispose()
      } catch {
        continue
      }
    }
  }

  private rollbackSubscriptions(subscriptions: Disposable[]): void {
    for (const subscription of [...subscriptions].reverse()) {
      try {
        void Promise.resolve(subscription.dispose()).catch(() => undefined)
      } catch {
        continue
      }
    }
  }
}
