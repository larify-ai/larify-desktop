import { BrowserWindow } from "electron"
import type { Rectangle } from "electron"
import type { BrowserState } from "../shared/types"
import { BrowserTab } from "./tab"
import { Recorder } from "./recorder"

const PARTITION = "persist:larify-browser"
const HOST_POSITION = { x: -3000, y: -3000 }

export class BrowserTabManager {
  private tabs = new Map<number, BrowserTab>()
  private activeId: number | null = null
  private nextId = 1
  private nextTemporaryId = -1
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  private visible = false
  private onChange?: (state: BrowserState) => void
  private readonly host: BrowserWindow
  private readonly viewParent = new Map<number, BrowserWindow>()
  private readonly closing = new Map<number, Promise<void>>()
  private readonly temporaryTabs = new Map<number, BrowserTab>()
  private readonly temporaryCancels = new Map<number, (error: Error) => void>()
  private readonly temporaryOperations = new Set<Promise<unknown>>()
  private readonly recorder = new Recorder()
  private destroyTask: Promise<void> | null = null
  private destroying = false
  private readonly handleWindowClosed = (): void => {
    if (!this.host.isDestroyed()) this.host.destroy()
  }

  constructor(private readonly window: BrowserWindow) {
    this.host = new BrowserWindow({
      show: true,
      x: HOST_POSITION.x,
      y: HOST_POSITION.y,
      width: 1280,
      height: 800,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { backgroundThrottling: false }
    })
    this.host.setPosition(HOST_POSITION.x, HOST_POSITION.y)
    this.window.once("closed", this.handleWindowClosed)
  }

  bindChange(cb: (state: BrowserState) => void): void {
    this.onChange = cb
  }

  get(id: number): BrowserTab | undefined {
    return this.tabs.get(id)
  }

  ensureTab(): void {
    if (this.tabs.size > 0) return
    this.createTab()
  }

  createTab(url?: string): number {
    if (this.destroying) throw new Error("browser tab manager is destroyed")
    const tab = new BrowserTab(this.nextId++, PARTITION)
    tab.bindChange(() => this.emit())
    tab.view.webContents.setWindowOpenHandler((details) => {
      if (!this.destroying) this.createTab(details.url || undefined)
      return { action: "deny" }
    })
    this.tabs.set(tab.id, tab)
    this.activeId = tab.id
    if (url) tab.navigate(url)
    this.applyLayout()
    this.emit()
    return tab.id
  }

  async withTemporaryTab<T>(url: string, callback: (tab: BrowserTab) => Promise<T>): Promise<T> {
    if (this.destroying) throw new Error("browser tab manager is destroyed")
    const tab = new BrowserTab(this.nextTemporaryId--, PARTITION)
    tab.view.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    const operation = this.runTemporaryTab(tab, url, callback)
    this.temporaryOperations.add(operation)
    try {
      return await operation
    } finally {
      this.temporaryOperations.delete(operation)
    }
  }

  private async runTemporaryTab<T>(
    tab: BrowserTab,
    url: string,
    callback: (tab: BrowserTab) => Promise<T>
  ): Promise<T> {
    let cancel!: (error: Error) => void
    const destroyed = new Promise<never>((_resolve, reject) => {
      cancel = reject
    })
    this.temporaryTabs.set(tab.id, tab)
    this.temporaryCancels.set(tab.id, cancel)
    try {
      if (url && !tab.navigate(url)) throw new Error(`invalid url: ${url}`)
      return await Promise.race([callback(tab), destroyed])
    } finally {
      this.temporaryCancels.delete(tab.id)
      this.temporaryTabs.delete(tab.id)
      if (!tab.view.webContents.isDestroyed()) tab.destroy()
    }
  }

  setActive(id: number): void {
    if (!this.tabs.has(id)) return
    this.activeId = id
    this.applyLayout()
    this.emit()
  }

  close(id: number): Promise<void> {
    if (this.destroyTask) return this.destroyTask
    const pending = this.closing.get(id)
    if (pending) return pending
    const tab = this.tabs.get(id)
    if (!tab) return Promise.resolve()
    const closing = this.closeTab(id, tab).finally(() => {
      if (this.closing.get(id) === closing) this.closing.delete(id)
    })
    this.closing.set(id, closing)
    return closing
  }

  private async closeTab(id: number, tab: BrowserTab): Promise<void> {
    await this.recorder.stopIfRecordingTab(id).catch(() => {})
    const order = [...this.tabs.keys()]
    const index = order.indexOf(id)
    this.viewParent.get(id)?.contentView.removeChildView(tab.view)
    this.viewParent.delete(id)
    tab.destroy()
    this.tabs.delete(id)

    if (this.activeId === id) {
      const remaining = [...this.tabs.keys()]
      this.activeId = remaining[index] ?? remaining[index - 1] ?? null
    }
    this.applyLayout()
    this.emit()
  }

  reorder(id: number, toIndex: number): void {
    if (!this.tabs.has(id)) return
    const ids = [...this.tabs.keys()]
    const from = ids.indexOf(id)
    const to = Math.max(0, Math.min(toIndex, ids.length - 1))
    if (from === to) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    const next = new Map<number, BrowserTab>()
    for (const tabId of ids) next.set(tabId, this.tabs.get(tabId)!)
    this.tabs = next
    this.emit()
  }

  navigate(id: number, url: string): boolean {
    return this.tabs.get(id)?.navigate(url) ?? false
  }

  goBack(id: number): void {
    this.tabs.get(id)?.goBack()
  }

  goForward(id: number): void {
    this.tabs.get(id)?.goForward()
  }

  reload(id: number): void {
    this.tabs.get(id)?.reload()
  }

  recordStart(tab: BrowserTab, path: string): Promise<number> {
    return this.recorder.start(tab, path)
  }

  recordStop(): Promise<{ path: string; bytes: number }> {
    return this.recorder.stop()
  }

  recordStopIfCurrent(generation: number): Promise<{ path: string; bytes: number } | null> {
    return this.recorder.stopIfCurrent(generation)
  }

  recordRestart(tab: BrowserTab, path: string): Promise<number> {
    return this.recorder.restart(tab, path)
  }

  setBounds(bounds: Rectangle): void {
    this.bounds = bounds
    this.applyLayout()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.applyLayout()
  }

  state(): BrowserState {
    return {
      tabs: [...this.tabs.values()].map((tab) => tab.state()),
      activeId: this.activeId
    }
  }

  destroy(): Promise<void> {
    if (this.destroyTask) return this.destroyTask
    this.destroying = true
    this.destroyTask = this.destroyResources()
    return this.destroyTask
  }

  private async destroyResources(): Promise<void> {
    this.window.removeListener("closed", this.handleWindowClosed)
    const destroyedError = new Error("browser tab manager was destroyed")
    for (const cancel of this.temporaryCancels.values()) cancel(destroyedError)
    for (const tab of this.temporaryTabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.destroy()
    }
    await Promise.allSettled([...this.temporaryOperations])
    await Promise.allSettled([...this.closing.values()])
    try {
      await this.recorder.destroy()
    } finally {
      for (const tab of this.tabs.values()) {
        this.viewParent.get(tab.id)?.contentView.removeChildView(tab.view)
        tab.destroy()
      }
      this.tabs.clear()
      this.viewParent.clear()
      this.activeId = null
      if (!this.host.isDestroyed()) this.host.destroy()
    }
  }

  private emit(): void {
    this.onChange?.(this.state())
  }

  private hostBounds(): Rectangle {
    return { x: 0, y: 0, width: this.bounds.width || 1280, height: this.bounds.height || 800 }
  }

  private placeView(tab: BrowserTab, target: BrowserWindow, bounds: Rectangle): void {
    const current = this.viewParent.get(tab.id)
    if (current !== target) {
      current?.contentView.removeChildView(tab.view)
      target.contentView.addChildView(tab.view)
      this.viewParent.set(tab.id, target)
    }
    tab.view.setBounds(bounds)
    tab.view.setVisible(true)
  }

  private hideView(tab: BrowserTab): void {
    const current = this.viewParent.get(tab.id)
    if (current !== this.host) {
      current?.contentView.removeChildView(tab.view)
      this.host.contentView.addChildView(tab.view)
      this.viewParent.set(tab.id, this.host)
    }
    tab.view.setBounds(this.hostBounds())
    tab.view.setVisible(true)
  }

  private applyLayout(): void {
    for (const tab of this.tabs.values()) {
      const active =
        this.visible && tab.id === this.activeId && this.bounds.width > 0 && this.bounds.height > 0
      if (active) this.placeView(tab, this.window, this.bounds)
      else this.hideView(tab)
    }
  }
}
