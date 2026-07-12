import type { App } from "./types"
import { Registry } from "./registry"
import { Events } from "./events"

export function createApp(): App {
  const registry = new Registry()
  const events = new Events()

  return {
    register: (kind, name, value) => registry.register(kind, name, value),
    get: (kind, name) => registry.get(kind, name),
    getAll: (kind) => registry.getAll(kind),
    on: (event, handler) => events.on(event, handler),
    emit: (event, payload) => events.emit(event, payload),
  }
}
