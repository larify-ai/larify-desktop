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

  async close(sessionId: string, id: number): Promise<void> {
    await this.managers.peek(sessionId)?.close(id)
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
    return this.manager(sessionId).recordStart(tab, path)
  }

  recordStop(sessionId: string): Promise<{ path: string; bytes: number }> {
    return this.manager(sessionId).recordStop()
  }

  recordStopIfCurrent(
    sessionId: string,
    generation: number
  ): Promise<{ path: string; bytes: number } | null> {
    return this.manager(sessionId).recordStopIfCurrent(generation)
  }

  recordRestart(sessionId: string, tab: BrowserTab, path: string): Promise<number> {
    return this.manager(sessionId).recordRestart(tab, path)
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

  async destroySession(sessionId: string): Promise<void> {
    await this.managers.destroySession(sessionId)
    this.bounds.delete(sessionId)
  }

  async destroy(): Promise<void> {
    await this.managers.destroyAll()
    this.bounds.clear()
  }

  private manager(sessionId: string): BrowserTabManager {
    return this.managers.get(sessionId)
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
