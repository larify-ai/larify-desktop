import type { Disposable } from '@shared/infra/disposable'
import { addListener, notify, type Listener } from '../../../main/utils/listener'
import type { DirectoryListing, FileDescriptor } from '../shared/types'
import { WorkspaceService } from './service'

type ResourceChange = [number, string, string]

export class WorkspaceManager implements Disposable {
  private readonly changeListeners = new Set<Listener<ResourceChange>>()
  private readonly workspaces = new Map<number, WorkspaceService>()

  bindChange(listener: (...change: ResourceChange) => void): () => void {
    return addListener(this.changeListeners, listener)
  }

  open(id: number, root: string): Disposable {
    if (this.workspaces.has(id)) throw new Error(`Workspace resource ${id} is already open`)

    const service = new WorkspaceService(root, (directory, changedPath) => {
      if (this.workspaces.get(id) === service) {
        notify(this.changeListeners, id, directory, changedPath)
      }
    })
    this.workspaces.set(id, service)

    return { dispose: () => this.close(id, service) }
  }

  async list(id: number, directory?: string): Promise<DirectoryListing> {
    const service = this.requireWorkspace(id)
    return { entries: await service.list(directory), root: await service.rootPath() }
  }

  reveal(id: number, file: string): Promise<string[]> {
    return this.requireWorkspace(id).reveal(file)
  }

  readFile(id: number, file: string): Promise<string> {
    return this.requireWorkspace(id).readFile(file)
  }

  inspectFile(id: number, file: string): Promise<FileDescriptor> {
    return this.requireWorkspace(id).inspectFile(file)
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.workspaces.keys()].map((id) => this.close(id)))
    this.changeListeners.clear()
  }

  private async close(id: number, expected?: WorkspaceService): Promise<void> {
    const service = this.workspaces.get(id)
    if (!service || (expected && service !== expected)) return
    this.workspaces.delete(id)
    await service.dispose()
  }

  private requireWorkspace(id: number): WorkspaceService {
    const service = this.workspaces.get(id)
    if (!service) throw new Error(`Workspace resource ${id} is not open`)
    return service
  }
}
