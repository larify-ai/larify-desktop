import type { BrowserWindow, Rectangle } from "electron"
import { addListener, type Listener } from "../../../main/utils/listener"
import { SessionScopedManagers } from "../../../main/utils/session-scoped-managers"
import type { BrowserState } from "../shared/types"
import { BrowserTabManager } from "./tab-manager"
import type { BrowserTab } from "./tab"

export class BrowserService {
  private readonly managers = new SessionScopedManagers(
    (sessionId) => this.createManager(sessionId),
    (manager: BrowserTabManager) => manager.destroy(),
  )
  private readonly changeListeners = new Set<Listener<[string, BrowserState]>>()
  private readonly bounds = new Map<string, Rectangle>()
  private readonly sessionDestructions = new Map<string, Promise<void>>()
  private destroyed = false

  constructor(private readonly window: BrowserWindow) {}

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
    return this.manager(sessionId).createTab(url)
  }

  ensureTab(sessionId: string): void {
    this.manager(sessionId).ensureTab()
  }

  setActive(sessionId: string, id: number): void {
    this.managers.peek(sessionId)?.setActive(id)
  }

  reorder(sessionId: string, id: number, toIndex: number): void {
    this.managers.peek(sessionId)?.reorder(id, toIndex)
  }

  async close(sessionId: string, id: number): Promise<BrowserState> {
    const manager = this.managers.peek(sessionId)
    await manager?.close(id)
    return manager?.state() ?? { tabs: [], activeId: null }
  }

  navigate(sessionId: string, id: number, url: string): boolean {
    return this.managers.peek(sessionId)?.navigate(id, url) ?? false
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

  setBounds(sessionId: string, bounds: Rectangle): void {
    this.bounds.set(sessionId, bounds)
    this.managers.peek(sessionId)?.setBounds(bounds)
  }

  setVisible(sessionId: string, visible: boolean): void {
    if (!visible) {
      this.managers.peek(sessionId)?.setVisible(false)
      return
    }
    this.managers.forEach((manager, managerSessionId) => {
      manager.setVisible(managerSessionId === sessionId)
    })
    this.manager(sessionId).setVisible(true)
  }

  destroySession(sessionId: string): Promise<void> {
    const existing = this.sessionDestructions.get(sessionId)
    if (existing) return existing
    const destroying = this.destroySessionManager(sessionId).finally(() => {
      if (this.sessionDestructions.get(sessionId) === destroying) {
        this.sessionDestructions.delete(sessionId)
      }
    })
    this.sessionDestructions.set(sessionId, destroying)
    return destroying
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    await Promise.allSettled([...this.sessionDestructions.values()])
    await this.managers.destroyAll()
    this.bounds.clear()
  }

  private manager(sessionId: string): BrowserTabManager {
    if (this.destroyed) throw new Error("browser service is destroyed")
    if (this.sessionDestructions.has(sessionId)) {
      throw new Error("browser session is being destroyed")
    }
    return this.managers.get(sessionId)
  }

  private async destroySessionManager(sessionId: string): Promise<void> {
    await this.managers.destroySession(sessionId)
    this.bounds.delete(sessionId)
  }

  private createManager(sessionId: string): BrowserTabManager {
    const manager = new BrowserTabManager(this.window)
    const bounds = this.bounds.get(sessionId)
    if (bounds) manager.setBounds(bounds)
    manager.bindChange((state) => {
      for (const listener of this.changeListeners) listener(sessionId, state)
    })
    return manager
  }
}
