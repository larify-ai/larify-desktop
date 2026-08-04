export interface Disposable {
  dispose(): void | Promise<void>
}

export interface Manifest {
  id: string
  version?: string
  displayName?: string
  description?: string
}

export interface ExtensionContext {
  manifest: Manifest
  subscriptions: Disposable[]
}

export interface Extension {
  activate(app: App, context: ExtensionContext): void | Promise<void>
}

export interface App {
  register(kind: string, name: string, value: unknown): Disposable
  get<T = unknown>(kind: string, name: string): T | undefined
  getAll<T = unknown>(kind: string): T[]
  on(event: string, handler: (payload: unknown) => void): Disposable
  emit(event: string, payload?: unknown): void
}
