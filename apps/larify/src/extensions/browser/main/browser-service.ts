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

  constructor(private readonly window: BrowserWindow) {}

  bindChange(callback: (sessionId: string, state: BrowserState) => void): () => void {
    return addListener(this.changeListeners, callback)
  }

  state(sessionId: string): BrowserState {
    return this.manager(sessionId).state()
  }

  tab(sessionId: string, id: number): BrowserTab | undefined {
    return this.manager(sessionId).get(id)
  }

  createTab(sessionId: string, url?: string): number {
    return this.manager(sessionId).createTab(url)
  }

  ensureTab(sessionId: string): void {
    this.manager(sessionId).ensureTab()
  }

  setActive(sessionId: string, id: number): void {
    this.manager(sessionId).setActive(id)
  }

  reorder(sessionId: string, id: number, toIndex: number): void {
    this.manager(sessionId).reorder(id, toIndex)
  }

  close(sessionId: string, id: number): void {
    this.manager(sessionId).close(id)
  }

  navigate(sessionId: string, id: number, url: string): boolean {
    return this.manager(sessionId).navigate(id, url)
  }

  goBack(sessionId: string, id: number): void {
    this.manager(sessionId).goBack(id)
  }

  goForward(sessionId: string, id: number): void {
    this.manager(sessionId).goForward(id)
  }

  reload(sessionId: string, id: number): void {
    this.manager(sessionId).reload(id)
  }

  recordStart(sessionId: string, tab: BrowserTab, path: string): Promise<void> {
    return this.manager(sessionId).recordStart(tab, path)
  }

  recordStop(sessionId: string): Promise<{ path: string; bytes: number }> {
    return this.manager(sessionId).recordStop()
  }

  recordRestart(sessionId: string, tab: BrowserTab, path: string): Promise<void> {
    return this.manager(sessionId).recordRestart(tab, path)
  }

  setBounds(sessionId: string, bounds: Rectangle): void {
    this.manager(sessionId).setBounds(bounds)
  }

  setVisible(sessionId: string, visible: boolean): void {
    this.managers.forEach((manager, managerSessionId) => {
      manager.setVisible(visible && managerSessionId === sessionId)
    })
    if (visible) this.manager(sessionId).setVisible(true)
  }

  destroySession(sessionId: string): Promise<void> {
    return this.managers.destroySession(sessionId)
  }

  destroy(): Promise<void> {
    return this.managers.destroyAll()
  }

  private manager(sessionId: string): BrowserTabManager {
    return this.managers.get(sessionId)
  }

  private createManager(sessionId: string): BrowserTabManager {
    const manager = new BrowserTabManager(this.window)
    manager.bindChange((state) => {
      for (const listener of this.changeListeners) listener(sessionId, state)
    })
    return manager
  }
}
