import type { WebContents } from "electron"
import { BROWSER_PARTITION, type BrowserState } from "../shared/types"
import { BrowserTab, type BrowserColorScheme } from "./tab"
import { Recorder } from "./recorder"

export class BrowserTabManager {
  private tabs = new Map<number, BrowserTab>()
  private recordingId: number | null = null
  private nextTemporaryId = -1
  private onChange?: (state: BrowserState) => void
  private readonly closing = new Map<number, Promise<void>>()
  private readonly temporaryTabs = new Map<number, BrowserTab>()
  private readonly temporaryCancels = new Map<number, (error: Error) => void>()
  private readonly temporaryOperations = new Set<Promise<unknown>>()
  private readonly activityLeases = new Map<number, number>()
  private readonly recorder = new Recorder()
  private destroyTask: Promise<void> | null = null
  private destroying = false

  constructor(
    private readonly openTab: (url?: string) => void = () => {},
    private colorScheme: BrowserColorScheme = "light",
  ) {}

  bindChange(cb: (state: BrowserState) => void): void {
    this.onChange = cb
  }

  get(id: number): BrowserTab | undefined {
    return this.availableTab(id)
  }

  createTab(id: number, url?: string): number {
    this.assertActive()
    if (this.tabs.has(id)) throw new Error("browser tab already exists")
    const tab = new BrowserTab(id, BROWSER_PARTITION, { deferred: true })
    tab.bindChange(() => this.emit())
    tab.bindOpen((popupUrl) => {
      if (!this.destroying) this.openTab(popupUrl)
    })
    this.tabs.set(tab.id, tab)
    if (url) tab.navigate(url)
    this.emit()
    return id
  }

  attach(id: number, contents: WebContents): void {
    const tab = this.requireAvailableTab(id)
    tab.attach(contents)
    void tab.setColorScheme(this.colorScheme).catch(() => {})
    contents.setWindowOpenHandler(() => ({ action: "deny" }))
    this.syncBackgroundThrottling(tab)
    this.emit()
  }

  async withTemporaryTab<T>(url: string, callback: (tab: BrowserTab) => Promise<T>): Promise<T> {
    this.assertActive()
    const tab = new BrowserTab(this.nextTemporaryId--, BROWSER_PARTITION)
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
      tab.webContents.setBackgroundThrottling(false)
      tab.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      if (url && !tab.navigate(url)) throw new Error(`invalid url: ${url}`)
      return await Promise.race([callback(tab), destroyed])
    } finally {
      this.temporaryCancels.delete(tab.id)
      this.temporaryTabs.delete(tab.id)
      tab.destroy()
    }
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
    this.activityLeases.delete(id)
    tab.destroy()
    this.tabs.delete(id)
    this.emit()
  }

  navigate(id: number, url: string): boolean {
    return this.availableTab(id)?.navigate(url) ?? false
  }

  goBack(id: number): void {
    this.availableTab(id)?.goBack()
  }

  goForward(id: number): void {
    this.availableTab(id)?.goForward()
  }

  reload(id: number): void {
    this.availableTab(id)?.reload()
  }

  setColorScheme(colorScheme: BrowserColorScheme): void {
    if (this.colorScheme === colorScheme) return
    this.colorScheme = colorScheme
    for (const tab of this.tabs.values()) {
      void tab.setColorScheme(colorScheme).catch(() => {})
    }
  }

  recordStart(tab: BrowserTab, path: string): Promise<number> {
    return this.recorder.start(tab, path)
  }

  isRecording(): boolean {
    return this.recorder.isRecording()
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
    if (id !== null && !this.availableTab(id)) throw new Error("browser tab not found")
    if (this.recordingId === id) return
    const previous = this.recordingId
    this.recordingId = id
    for (const tabId of [previous, id]) {
      if (tabId === null) continue
      const tab = this.tabs.get(tabId)
      if (!tab) continue
      this.syncBackgroundThrottling(tab)
    }
  }

  async withRendered<T>(id: number, operation: () => Promise<T>): Promise<T> {
    return this.withUnthrottled(id, async () => {
      const tab = this.tabs.get(id)
      if (!tab) throw new Error("browser tab not found")
      await tab.acquireRendering()
      try {
        return await operation()
      } finally {
        await tab.releaseRendering()
      }
    })
  }

  async withUnthrottled<T>(id: number, operation: () => Promise<T>): Promise<T> {
    const tab = this.requireAvailableTab(id)
    await tab.ready()
    if (this.requireAvailableTab(id) !== tab) throw new Error("browser tab not found")
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

  state(): BrowserState {
    return {
      tabs: [...this.tabs.values()].map((tab) => tab.state())
    }
  }

  destroy(): Promise<void> {
    if (this.destroyTask) return this.destroyTask
    this.destroying = true
    this.destroyTask = this.destroyResources()
    return this.destroyTask
  }

  private async destroyResources(): Promise<void> {
    const destroyedError = new Error("browser tab manager was destroyed")
    for (const cancel of this.temporaryCancels.values()) cancel(destroyedError)
    for (const tab of this.temporaryTabs.values()) {
      tab.destroy()
    }
    await Promise.allSettled([...this.temporaryOperations])
    await Promise.allSettled([...this.closing.values()])
    try {
      await this.recorder.destroy()
    } finally {
      for (const tab of this.tabs.values()) {
        tab.destroy()
      }
      this.tabs.clear()
      this.activityLeases.clear()
    }
  }

  private emit(): void {
    this.onChange?.(this.state())
  }

  private assertActive(): void {
    if (this.destroying) throw new Error("browser tab manager is destroyed")
  }

  private requireAvailableTab(id: number): BrowserTab {
    this.assertActive()
    const tab = this.availableTab(id)
    if (!tab) throw new Error("browser tab not found")
    return tab
  }

  private availableTab(id: number): BrowserTab | undefined {
    if (this.destroying || this.closing.has(id)) return
    return this.tabs.get(id)
  }

  private syncBackgroundThrottling(tab: BrowserTab): void {
    const active = tab.id === this.recordingId || (this.activityLeases.get(tab.id) ?? 0) > 0
    tab.setBackgroundThrottling(!active)
  }
}
