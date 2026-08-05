import type { Extension } from '..'

export interface ExtensionLoader {
  load(): Promise<Extension>
}

export interface ExtensionSource {
  discover(): Promise<ExtensionLoader[]>
}

export async function discoverExtensions(sources: ExtensionSource[]): Promise<ExtensionLoader[]> {
  return (await Promise.all(sources.map((source) => source.discover()))).flat()
}

export { BuiltinExtensionSource, builtinExtensionSource, builtinModules } from './builtin'
