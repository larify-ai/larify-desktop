import type { EmitArgsWithName } from 'chokidar'
import type { Disposable } from '@shared/infra/disposable'
import { addListener, notify, type Listener } from '../../../main/utils/listener'
import type { DirectoryListing } from '../shared/types'
import { WorkspaceService } from './service'

type WorkspaceChange = [number, EmitArgsWithName[0], string]

export class WorkspaceManager implements Disposable {
  private readonly changeListeners = new Set<Listener<WorkspaceChange>>()
  private readonly workspaces = new Map<number, WorkspaceService>()

  bindChange(listener: (...change: WorkspaceChange) => void): () => void {
    return addListener(this.changeListeners, listener)
  }

  open(id: number, root: string): Disposable {
    if (this.workspaces.has(id)) throw new Error(`Workspace resource ${id} is already open`)

    const service = new WorkspaceService(root, (event, changedPath) => {
      if (this.workspaces.get(id) === service) {
        notify(this.changeListeners, id, event, changedPath)
      }
    })
    this.workspaces.set(id, service)

    return { dispose: () => this.close(id) }
  }

  async list(id: number, directory?: string): Promise<DirectoryListing> {
    const service = this.requireWorkspace(id)
    return { entries: await service.list(directory), root: await service.rootPath() }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.workspaces.keys()].map((id) => this.close(id)))
    this.changeListeners.clear()
  }

  private async close(id: number): Promise<void> {
    const service = this.workspaces.get(id)
    if (!service) return
    this.workspaces.delete(id)
    await service.dispose()
  }

  private requireWorkspace(id: number): WorkspaceService {
    const service = this.workspaces.get(id)
    if (!service) throw new Error(`Workspace resource ${id} is not open`)
    return service
  }
}
