import type { Disposable } from '@shared/infra/disposable'
import type { Resource, ResourceQuery } from '@shared/resource'
import { addListener, type Listener } from '../../utils/listener'

export class ResourceManager implements Disposable {
  private readonly resources = new Map<number, Resource & Disposable>()
  private readonly changeListeners = new Set<Listener<[Resource[]]>>()
  private nextId = 1

  bindChange(listener: (resources: Resource[]) => void): () => void {
    return addListener(this.changeListeners, listener)
  }

  create(type: string, sessionId: string, open: (id: number) => Disposable): number {
    const id = this.nextId++
    const disposable = open(id)
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
    const resource = this.resources.get(id)
    if (!resource) return
    this.resources.delete(id)
    this.emit()
    await resource.dispose()
  }

  async destroy(sessionId: string): Promise<void> {
    const ids = this.list({ sessionId }).map(({ id }) => id)
    await Promise.allSettled(ids.map((id) => this.close(id)))
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.list().map(({ id }) => this.close(id)))
  }

  private emit(): void {
    const resources = this.list()
    for (const listener of this.changeListeners) {
      try {
        listener(resources)
      } catch {
        continue
      }
    }
  }
}
