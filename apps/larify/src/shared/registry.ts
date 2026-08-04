import type { Disposable } from "./types"

export class Registry {
  private byKind = new Map<string, Map<string, unknown>>()

  register(kind: string, name: string, value: unknown): Disposable {
    let items = this.byKind.get(kind)
    if (!items) {
      items = new Map()
      this.byKind.set(kind, items)
    }
    items.set(name, value)
    return {
      dispose: () => {
        if (items.get(name) !== value) return
        items.delete(name)
        if (items.size === 0 && this.byKind.get(kind) === items) this.byKind.delete(kind)
      },
    }
  }

  get<T = unknown>(kind: string, name: string): T | undefined {
    return this.byKind.get(kind)?.get(name) as T | undefined
  }

  getAll<T = unknown>(kind: string): T[] {
    return [...(this.byKind.get(kind)?.values() ?? [])] as T[]
  }
}
