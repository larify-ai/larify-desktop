import type { Disposable } from './disposable'

export type ServiceToken = symbol

export function defineService(): ServiceToken {
  return Symbol()
}

export class Registry {
  private readonly services = new Map<ServiceToken, unknown>()

  register<T>(token: ServiceToken, value: T): void {
    if (this.services.has(token)) throw new Error('Service is already registered.')
    this.services.set(token, value)
  }

  get<T>(token: ServiceToken): T | undefined {
    return this.services.get(token) as T | undefined
  }

  async dispose(token: ServiceToken): Promise<void> {
    const service = this.services.get(token)
    this.services.delete(token)
    if (isDisposable(service)) await service.dispose()
  }

  async disposeAll(): Promise<void> {
    for (const token of [...this.services.keys()].reverse()) {
      try {
        await this.dispose(token)
      } catch {
        continue
      }
    }
  }
}

function isDisposable(value: unknown): value is Disposable {
  return value != null && typeof (value as Partial<Disposable>).dispose === 'function'
}
