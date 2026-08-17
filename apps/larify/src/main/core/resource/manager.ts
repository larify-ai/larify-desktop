import type { Disposable } from '@shared/infra/disposable'
import type { Resource, ResourceQuery } from '@shared/resource'
import { addListener, notify, type Listener } from '../../utils/listener'

export type ResourceFactory = (id: number, sessionId: string, options: unknown) => Disposable

type SessionCleanup = (sessionId: string) => void | Promise<void>

export class ResourceManager implements Disposable {
  private readonly resources = new Map<number, Resource & Disposable>()
  private readonly changeListeners = new Set<Listener<[Resource[]]>>()
  private readonly factories = new Map<string, ResourceFactory>()
  private readonly sessionCleanups = new Set<SessionCleanup>()
  private readonly sessionDestructions = new Map<string, Promise<void>>()
  private nextId = 1

  bindChange(listener: (resources: Resource[]) => void): () => void {
    return addListener(this.changeListeners, listener)
  }

  register(type: string, factory: ResourceFactory): Disposable {
    if (this.factories.has(type)) throw new Error(`Resource type "${type}" is already registered.`)
    this.factories.set(type, factory)
    return {
      dispose: () => {
        if (this.factories.get(type) === factory) this.factories.delete(type)
      }
    }
  }

  registerSessionCleanup(cleanup: SessionCleanup): Disposable {
    this.sessionCleanups.add(cleanup)
    return {
      dispose: () => {
        this.sessionCleanups.delete(cleanup)
      }
    }
  }

  create(type: string, sessionId: string, options?: unknown): number {
    if (this.sessionDestructions.has(sessionId)) {
      throw new Error(`Resource session "${sessionId}" is being destroyed.`)
    }
    const factory = this.factories.get(type)
    if (!factory) throw new Error(`Resource type "${type}" is not registered.`)
    const id = this.nextId++
    const disposable = factory(id, sessionId, options)
    this.resources.set(id, { id, type, sessionId, dispose: () => disposable.dispose() })
    this.emit()
    return id
  }

  get(id: number): Resource | undefined {
    const resource = this.resources.get(id)
    if (!resource) return undefined
    const { type, sessionId } = resource
    return { id, type, sessionId }
  }

  list(query: ResourceQuery = {}): Resource[] {
    return [...this.resources.values()]
      .filter(
        (resource) =>
          (query.sessionId === undefined || resource.sessionId === query.sessionId) &&
          (query.type === undefined || resource.type === query.type)
      )
      .map(({ id, type, sessionId }) => ({ id, type, sessionId }))
  }

  async close(id: number): Promise<void> {
    await this.closeMany([id])
  }

  async closeMany(ids: readonly number[]): Promise<void> {
    const resources = [...new Set(ids)]
      .map((id) => this.resources.get(id))
      .filter((resource) => resource !== undefined)
    if (resources.length === 0) return
    for (const resource of resources) this.resources.delete(resource.id)
    this.emit()
    await Promise.all(resources.map((resource) => resource.dispose()))
  }

  destroy(sessionId: string): Promise<void> {
    const existing = this.sessionDestructions.get(sessionId)
    if (existing) return existing
    const destroying = this.destroySession(sessionId).finally(() => {
      if (this.sessionDestructions.get(sessionId) === destroying) {
        this.sessionDestructions.delete(sessionId)
      }
    })
    this.sessionDestructions.set(sessionId, destroying)
    return destroying
  }

  private async destroySession(sessionId: string): Promise<void> {
    const ids = this.list({ sessionId }).map(({ id }) => id)
    await Promise.allSettled(ids.map((id) => this.close(id)))
    await Promise.allSettled([...this.sessionCleanups].map((cleanup) => cleanup(sessionId)))
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.list().map(({ id }) => this.close(id)))
  }

  private emit(): void {
    notify(this.changeListeners, this.list())
  }
}
