import type { Extension } from '../../../shared/extension'

export interface ExtensionLoader {
  load(): Promise<Extension>
}

export interface ExtensionSource {
  discover(): Promise<ExtensionLoader[]>
}

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

export async function discoverExtensions(sources: ExtensionSource[]): Promise<ExtensionLoader[]> {
  return (await Promise.all(sources.map((source) => source.discover()))).flat()
}
