import type { Extension } from '..'
import type { ExtensionLoader, ExtensionSource } from '.'

type ExtensionModule = { default: Extension }
type ModuleLoader = () => Promise<ExtensionModule>

export class BuiltinExtensionSource implements ExtensionSource {
  constructor(private readonly modules: Record<string, ModuleLoader>) {}

  async discover(): Promise<ExtensionLoader[]> {
    return Object.values(this.modules).map((load) => ({
      load: async () => (await load()).default
    }))
  }
}

export const builtinModules = import.meta.glob<ExtensionModule>(
  '../../../extensions/*/main/index.ts'
)

export const builtinExtensionSource = new BuiltinExtensionSource(builtinModules)
