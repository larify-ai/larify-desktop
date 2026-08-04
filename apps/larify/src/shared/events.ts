import type { Disposable } from "./types"

type Handler = (payload: unknown) => void

export class Events {
  private handlers = new Map<string, Set<Handler>>()

  on(event: string, handler: Handler): Disposable {
    const set = this.handlers.get(event) ?? new Set()
    set.add(handler)
    this.handlers.set(event, set)
    return {
      dispose: () => {
        set.delete(handler)
        if (set.size === 0 && this.handlers.get(event) === set) {
          this.handlers.delete(event)
        }
      },
    }
  }

  emit(event: string, payload?: unknown): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const handler of [...set]) {
      try {
        handler(payload)
      } catch {
      }
    }
  }
}
