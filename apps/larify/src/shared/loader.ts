import type { App, Disposable, Extension, ExtensionContext, Manifest } from "./types"

export type ImportFn = (manifest: Manifest) => Promise<{ default: Extension }>

function scopedApp(app: App, subscriptions: Disposable[]): App {
  return {
    register: (kind, name, value) => {
      const d = app.register(kind, name, value)
      subscriptions.push(d)
      return d
    },
    on: (event, handler) => {
      const d = app.on(event, handler)
      subscriptions.push(d)
      return d
    },
    get: (kind, name) => app.get(kind, name),
    getAll: (kind) => app.getAll(kind),
    emit: (event, payload) => app.emit(event, payload),
  }
}

async function disposeAll(subscriptions: Disposable[]): Promise<void> {
  for (const d of [...subscriptions].reverse()) {
    try {
      await d.dispose()
    } catch {
    }
  }
}

export class Loader {
  private loaded = new Map<string, ExtensionContext>()

  constructor(
    private readonly app: App,
    private readonly importExtension: ImportFn,
  ) {}

  isLoaded(id: string): boolean {
    return this.loaded.has(id)
  }

  async load(manifest: Manifest): Promise<void> {
    if (this.isLoaded(manifest.id)) return
    const subscriptions: Disposable[] = []
    const context: ExtensionContext = { manifest, subscriptions }
    const mod = await this.importExtension(manifest)
    try {
      await mod.default.activate(scopedApp(this.app, subscriptions), context)
    } catch (err) {
      await disposeAll(subscriptions)
      throw err
    }
    this.loaded.set(manifest.id, context)
  }

  async unload(id: string): Promise<void> {
    const context = this.loaded.get(id)
    if (!context) return
    this.loaded.delete(id)
    await disposeAll(context.subscriptions)
  }

  async reload(manifest: Manifest): Promise<void> {
    await this.unload(manifest.id)
    await this.load(manifest)
  }

  async loadAll(manifests: Manifest[]): Promise<void> {
    for (const m of manifests) await this.load(m)
  }

  async unloadAll(): Promise<void> {
    for (const id of [...this.loaded.keys()].reverse()) await this.unload(id)
  }
}
