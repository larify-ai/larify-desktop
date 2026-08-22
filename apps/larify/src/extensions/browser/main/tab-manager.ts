import { BrowserWindow } from "electron"
import type { Rectangle } from "electron"
import type { BrowserState } from "../shared/types"
import { BrowserTab } from "./tab"
import { Recorder } from "./recorder"

export const BROWSER_PARTITION = "persist:larify-browser"
const HOST_POSITION = { x: -3000, y: -3000 }
const HOST_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 }

const sameBounds = (left: Rectangle, right: Rectangle): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height

export class BrowserTabManager {
  private tabs = new Map<number, BrowserTab>()
  private activeId: number | null = null
  private recordingId: number | null = null
  private nextTemporaryId = -1
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  private liveResize = false
  private visible = false
  private onChange?: (state: BrowserState) => void
  private readonly host: BrowserWindow
  private readonly viewParent = new Map<number, BrowserWindow>()
  private readonly closing = new Map<number, Promise<void>>()
  private readonly temporaryTabs = new Map<number, BrowserTab>()
  private readonly temporaryCancels = new Map<number, (error: Error) => void>()
  private readonly temporaryOperations = new Set<Promise<unknown>>()
  private readonly renderLeases = new Map<number, number>()
  private readonly activityLeases = new Map<number, number>()
  private readonly recorder = new Recorder()
  private destroyTask: Promise<void> | null = null
  private destroying = false
  private readonly handleWindowClosed = (): void => {
    if (!this.host.isDestroyed()) this.host.destroy()
  }

  constructor(
    private readonly window: BrowserWindow,
    private readonly openTab: (url?: string) => void = () => {}
  ) {
    this.host = new BrowserWindow({
      show: true,
      x: HOST_POSITION.x,
      y: HOST_POSITION.y,
      width: 1280,
      height: 800,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { backgroundThrottling: true }
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

  isActive(id: number): boolean {
    return this.activeId === id
  }

  createTab(id: number, url?: string, activate = true): number {
    if (this.destroying) throw new Error("browser tab manager is destroyed")
    const previous = activate && this.activeId !== null ? this.tabs.get(this.activeId) : undefined
    const tab = new BrowserTab(id, BROWSER_PARTITION)
    tab.view.setVisible(true)
    tab.bindChange(() => this.emit())
    tab.view.webContents.setWindowOpenHandler((details) => {
      if (!this.destroying) {
        try {
          this.openTab(details.url || undefined)
        } catch {
          return { action: "deny" }
        }
      }
      return { action: "deny" }
    })
    this.tabs.set(tab.id, tab)
    if (url) tab.navigate(url)
    if (activate) {
      this.activeId = tab.id
      if (previous) this.hideView(previous)
      this.layoutActive()
    } else {
      this.hideView(tab)
    }
    this.emit()
    return id
  }

  async withTemporaryTab<T>(url: string, callback: (tab: BrowserTab) => Promise<T>): Promise<T> {
    if (this.destroying) throw new Error("browser tab manager is destroyed")
    const tab = new BrowserTab(this.nextTemporaryId--, BROWSER_PARTITION)
    tab.view.webContents.setBackgroundThrottling(false)
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
    if (this.activeId === id || !this.tabs.has(id)) return
    const previous = this.activeId === null ? undefined : this.tabs.get(this.activeId)
    this.activeId = id
    if (previous) this.hideView(previous)
    this.layoutActive()
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
    if (this.recordingId === id) this.recordingId = null
    const order = [...this.tabs.keys()]
    const index = order.indexOf(id)
    this.viewParent.get(id)?.contentView.removeChildView(tab.view)
    this.viewParent.delete(id)
    tab.destroy()
    this.tabs.delete(id)

    if (this.activeId === id) {
      const remaining = [...this.tabs.keys()]
      this.activeId = remaining[index] ?? remaining[index - 1] ?? null
      this.layoutActive()
    }
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

  setRecording(id: number | null): void {
    if (id !== null && !this.tabs.has(id)) throw new Error("browser tab not found")
    if (this.recordingId === id) return
    const previous = this.recordingId
    this.recordingId = id
    for (const tabId of [previous, id]) {
      if (tabId === null) continue
      const tab = this.tabs.get(tabId)
      if (!tab) continue
      this.syncBackgroundThrottling(tab)
      this.syncOffscreenVisibility(tab)
    }
    this.layoutActive()
  }

  async withRendered<T>(id: number, operation: () => Promise<T>): Promise<T> {
    return this.withUnthrottled(id, async () => {
      const tab = this.tabs.get(id)
      if (!tab) throw new Error("browser tab not found")
      const previous = this.renderLeases.get(id) ?? 0
      this.renderLeases.set(id, previous + 1)
      this.syncOffscreenVisibility(tab)
      try {
        if (previous === 0 && this.viewParent.get(id) === this.host) {
          tab.view.webContents.invalidate()
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        return await operation()
      } finally {
        const remaining = (this.renderLeases.get(id) ?? 1) - 1
        if (remaining > 0) this.renderLeases.set(id, remaining)
        else this.renderLeases.delete(id)
        const current = this.tabs.get(id)
        if (current) this.syncOffscreenVisibility(current)
      }
    })
  }

  async withUnthrottled<T>(id: number, operation: () => Promise<T>): Promise<T> {
    const tab = this.tabs.get(id)
    if (!tab) throw new Error("browser tab not found")
    this.activityLeases.set(id, (this.activityLeases.get(id) ?? 0) + 1)
    this.syncBackgroundThrottling(tab)
    try {
      return await operation()
    } finally {
      const remaining = (this.activityLeases.get(id) ?? 1) - 1
      if (remaining > 0) this.activityLeases.set(id, remaining)
      else this.activityLeases.delete(id)
      const current = this.tabs.get(id)
      if (current) this.syncBackgroundThrottling(current)
    }
  }

  setBounds(bounds: Rectangle, live = false): void {
    const nextBounds = live ? { ...this.bounds, x: bounds.x } : bounds
    if (sameBounds(this.bounds, nextBounds) && live === this.liveResize) return
    this.bounds = nextBounds
    this.liveResize = live
    this.layoutActive()
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    this.layoutActive()
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
      this.renderLeases.clear()
      this.activityLeases.clear()
      this.activeId = null
      if (!this.host.isDestroyed()) this.host.destroy()
    }
  }

  private emit(): void {
    this.onChange?.(this.state())
  }

  private placeView(tab: BrowserTab, target: BrowserWindow, bounds: Rectangle): void {
    const current = this.viewParent.get(tab.id)
    const moved = current !== target
    if (moved) {
      current?.contentView.removeChildView(tab.view)
      target.contentView.addChildView(tab.view)
      this.viewParent.set(tab.id, target)
    }
    tab.view.setBounds(bounds)
    if (moved) tab.view.setVisible(true)
  }

  private hideView(tab: BrowserTab): void {
    this.liveResize = false
    const current = this.viewParent.get(tab.id)
    if (current !== this.host) {
      current?.contentView.removeChildView(tab.view)
      this.host.contentView.addChildView(tab.view)
      this.viewParent.set(tab.id, this.host)
      tab.view.setBounds(HOST_BOUNDS)
    }
    this.syncOffscreenVisibility(tab)
  }

  private syncOffscreenVisibility(tab: BrowserTab): void {
    if (this.viewParent.get(tab.id) !== this.host) return
    tab.view.setVisible(tab.id === this.recordingId || (this.renderLeases.get(tab.id) ?? 0) > 0)
  }

  private syncBackgroundThrottling(tab: BrowserTab): void {
    const active = tab.id === this.recordingId || (this.activityLeases.get(tab.id) ?? 0) > 0
    tab.view.webContents.setBackgroundThrottling(!active)
  }

  private layoutActive(): void {
    if (this.activeId === null) return
    const tab = this.tabs.get(this.activeId)
    if (!tab) return
    const visible = this.visible && this.bounds.width > 0 && this.bounds.height > 0
    if (visible) this.placeView(tab, this.window, this.bounds)
    else this.hideView(tab)
  }
}
