import type { Manifest } from "kernel"

export function discoverExtensions<T>(modules: Record<string, T>): {
  extensions: Manifest[]
  loaders: Map<string, T>
} {
  const loaders = new Map<string, T>()
  for (const [key, load] of Object.entries(modules)) {
    const seg = key.split("/")
    const id = seg[seg.indexOf("extensions") + 1]
    loaders.set(id, load)
  }
  return { extensions: [...loaders.keys()].map((id) => ({ id })), loaders }
}
