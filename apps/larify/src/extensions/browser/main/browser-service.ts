import { session, type BrowserWindow, type Rectangle } from "electron"
import { addListener, type Listener } from "../../../main/utils/listener"
import { prepareResponseOutput, type ToolPayload } from "../../../main/utils/tool-output"
import { SessionScopedManagers } from "../../../main/utils/session-scoped-managers"
import type { ResourceManager } from "../../../main/core/resource"
import type { Disposable } from "../../../shared/infra/disposable"
import type { BrowserState } from "../shared/types"
import { BROWSER_PARTITION, BrowserTabManager } from "./tab-manager"
import type { BrowserTab } from "./tab"
import { resolveAddress } from "./url"
import { isText } from "./content-type"

export class BrowserService {
  private readonly managers = new SessionScopedManagers(
    (sessionId) => this.createManager(sessionId),
    (manager: BrowserTabManager) => manager.destroy(),
  )
  private readonly changeListeners = new Set<Listener<[string, BrowserState]>>()
  private readonly resourceRegistration: Disposable
  private readonly sessionCleanupRegistration: Disposable
  private visibleResource?: { id: number; sessionId: string }
  private destroyTask: Promise<void> | null = null
  private destroyed = false

  constructor(
    private readonly window: BrowserWindow,
    private readonly resources: ResourceManager
  ) {
    this.resourceRegistration = resources.register('browser', (id, sessionId, options) =>
      this.openResource(id, sessionId, options as { url?: string } | undefined)
    )
    this.sessionCleanupRegistration = resources.registerSessionCleanup((sessionId) =>
      this.managers.destroySession(sessionId)
    )
  }

  bindChange(callback: (sessionId: string, state: BrowserState) => void): () => void {
    return addListener(this.changeListeners, callback)
  }

  state(sessionId: string): BrowserState {
    return this.managers.peek(sessionId)?.state() ?? { tabs: [], activeId: null }
  }

  tab(sessionId: string, id: number): BrowserTab | undefined {
    return this.managers.peek(sessionId)?.get(id)
  }

  createTab(sessionId: string, url?: string): number {
    return this.resources.create('browser', sessionId, { url })
  }

  private openResource(
    id: number,
    sessionId: string,
    options?: { url?: string }
  ): Disposable {
    const existingManager = this.managers.peek(sessionId)
    const manager = this.manager(sessionId)
    try {
      manager.createTab(id, options?.url)
    } catch (error) {
      if (!existingManager) void this.managers.destroySession(sessionId).catch(() => {})
      throw error
    }
    return { dispose: () => manager.close(id) }
  }

  withTemporaryTab<T>(
    sessionId: string,
    url: string,
    callback: (tab: BrowserTab) => Promise<T>
  ): Promise<T> {
    return this.manager(sessionId).withTemporaryTab(url, callback)
  }

  async readText(url: string, signal?: AbortSignal): Promise<ToolPayload | undefined> {
    const response = await session.fromPartition(BROWSER_PARTITION).fetch(url, { signal })
    if (!response.ok || !isText(response.headers.get("content-type"))) return
    return prepareResponseOutput(response)
  }

  async close(sessionId: string, id: number): Promise<void> {
    const resource = this.resources.get(id)
    if (resource?.type === 'browser' && resource.sessionId === sessionId) {
      await this.resources.close(id)
    }
  }

  navigate(sessionId: string, id: number, url: string): boolean {
    const target = resolveAddress(url)
    return target ? (this.managers.peek(sessionId)?.navigate(id, target) ?? false) : false
  }

  goBack(sessionId: string, id: number): void {
    this.managers.peek(sessionId)?.goBack(id)
  }

  goForward(sessionId: string, id: number): void {
    this.managers.peek(sessionId)?.goForward(id)
  }

  reload(sessionId: string, id: number): void {
    this.managers.peek(sessionId)?.reload(id)
  }

  recordStart(sessionId: string, tab: BrowserTab, path: string): Promise<number> {
    const manager = this.managers.peek(sessionId)
    if (!manager) return Promise.reject(new Error("browser session is not active"))
    return manager.recordStart(tab, path)
  }

  recordStop(sessionId: string): Promise<{ path: string; bytes: number }> {
    const manager = this.managers.peek(sessionId)
    if (!manager) return Promise.reject(new Error("no recording in progress"))
    return manager.recordStop()
  }

  recordStopIfCurrent(
    sessionId: string,
    generation: number
  ): Promise<{ path: string; bytes: number } | null> {
    return this.managers.peek(sessionId)?.recordStopIfCurrent(generation) ?? Promise.resolve(null)
  }

  recordRestart(sessionId: string, tab: BrowserTab, path: string): Promise<number> {
    const manager = this.managers.peek(sessionId)
    if (!manager) return Promise.reject(new Error("browser session is not active"))
    return manager.recordRestart(tab, path)
  }

  setBounds(sessionId: string, id: number, bounds: Rectangle): void {
    const manager = this.managers.peek(sessionId)
    if (manager?.state().activeId === id) manager.setBounds(bounds)
  }

  setVisible(sessionId: string, id: number, visible: boolean): void {
    if (!visible) {
      if (this.visibleResource?.id !== id) return
      this.managers.peek(this.visibleResource.sessionId)?.setVisible(false)
      this.visibleResource = undefined
      return
    }
    const resource = this.resources.get(id)
    const manager = this.managers.peek(sessionId)
    if (resource?.type !== 'browser' || resource.sessionId !== sessionId || !manager) return
    this.managers.forEach((manager, managerSessionId) => {
      manager.setVisible(managerSessionId === sessionId)
    })
    this.visibleResource = { id, sessionId }
    manager.setActive(id)
    manager.setVisible(true)
  }

  destroy(): Promise<void> {
    if (this.destroyTask) return this.destroyTask
    this.destroyed = true
    this.resourceRegistration.dispose()
    this.sessionCleanupRegistration.dispose()
    this.destroyTask = this.destroyResources()
    return this.destroyTask
  }

  private async destroyResources(): Promise<void> {
    const ids = this.resources.list({ type: 'browser' }).map(({ id }) => id)
    await Promise.allSettled(ids.map((id) => this.resources.close(id)))
    await this.managers.destroyAll()
  }

  private manager(sessionId: string): BrowserTabManager {
    if (this.destroyed) throw new Error("browser service is destroyed")
    return this.managers.get(sessionId)
  }

  private createManager(sessionId: string): BrowserTabManager {
    const manager = new BrowserTabManager(this.window, (url) => this.createTab(sessionId, url))
    manager.bindChange((state) => {
      for (const listener of this.changeListeners) listener(sessionId, state)
    })
    return manager
  }
}
