import type { Disposable } from '@shared/infra/disposable'
import { addListener, notify, type Listener } from '../../../main/utils/listener'
import type { DirectoryListing, FileDescriptor } from '../shared/types'
import { WorkspaceService } from './service'

type ResourceChange = [number, string, string]

export class WorkspaceManager implements Disposable {
  private readonly changeListeners = new Set<Listener<ResourceChange>>()
  private readonly workspaces = new Map<
    number,
    { service: WorkspaceService; sessionId: string | null }
  >()
  private activeSessionId: string | null = null
  private activationTask = Promise.resolve()

  bindChange(listener: (...change: ResourceChange) => void): () => void {
    return addListener(this.changeListeners, listener)
  }

  open(id: number, root: string): Disposable
  open(id: number, sessionId: string, root: string): Disposable
  open(id: number, sessionOrRoot: string, resourceRoot?: string): Disposable {
    if (this.workspaces.has(id)) throw new Error(`Workspace resource ${id} is already open`)
    const sessionId = resourceRoot === undefined ? null : sessionOrRoot
    const root = resourceRoot ?? sessionOrRoot

    const service = new WorkspaceService(
      root,
      (directory, changedPath) => {
        if (this.workspaces.get(id)?.service === service) {
          notify(this.changeListeners, id, directory, changedPath)
        }
      },
      sessionId === null || sessionId === this.activeSessionId
    )
    this.workspaces.set(id, { service, sessionId })

    return { dispose: () => this.close(id, service) }
  }

  setActiveSession(sessionId: string): Promise<void> {
    if (this.activeSessionId === sessionId) return this.activationTask
    this.activeSessionId = sessionId
    this.activationTask = this.activationTask.then(() => this.applyActiveSession(sessionId))
    return this.activationTask
  }

  private async applyActiveSession(sessionId: string): Promise<void> {
    if (this.activeSessionId !== sessionId) return
    await Promise.allSettled(
      [...this.workspaces.entries()].map(async ([id, entry]) => {
        const active = entry.sessionId === null || entry.sessionId === sessionId
        await entry.service.setActive(active)
        if (!active) return
        const root = await entry.service.rootPath()
        if (this.activeSessionId !== sessionId || this.workspaces.get(id) !== entry) return
        notify(this.changeListeners, id, root, root)
      })
    )
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

  readAsset(id: number, file: string): Promise<{ bytes: Uint8Array; mime: string }> {
    return this.requireWorkspace(id).readAsset(file)
  }

  inspectFile(id: number, file: string): Promise<FileDescriptor> {
    return this.requireWorkspace(id).inspectFile(file)
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.workspaces.keys()].map((id) => this.close(id)))
    this.changeListeners.clear()
  }

  private async close(id: number, expected?: WorkspaceService): Promise<void> {
    const entry = this.workspaces.get(id)
    if (!entry || (expected && entry.service !== expected)) return
    this.workspaces.delete(id)
    await entry.service.dispose()
  }

  private requireWorkspace(id: number): WorkspaceService {
    const entry = this.workspaces.get(id)
    if (!entry) throw new Error(`Workspace resource ${id} is not open`)
    return entry.service
  }
}
