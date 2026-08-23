import { nativeTheme, session, type BrowserWindow, type WebContents } from "electron"
import { addListener, type Listener } from "../../../main/utils/listener"
import { prepareResponseOutput, type ToolPayload } from "../../../main/utils/tool-output"
import { SessionScopedManagers } from "../../../main/utils/session-scoped-managers"
import type { ResourceManager } from "../../../main/core/resource"
import type { Disposable } from "../../../shared/infra/disposable"
import { BROWSER_PARTITION, type BrowserState } from "../shared/types"
import { BrowserTabManager } from "./tab-manager"
import type { BrowserTab } from "./tab"
import { resolveAddress } from "./url"
import { isText } from "./content-type"

interface ActiveRecording {
  generation: number | null
  previous?: ActiveRecording
  rendererLease: boolean
  resourceId: number
  sessionId: string
  stopping: boolean
}

interface RendererRenderLease {
  count: number
  ready: Promise<void>
}

export class BrowserService {
  private readonly managers = new SessionScopedManagers(
    (sessionId) => this.createManager(sessionId),
    (manager: BrowserTabManager) => manager.destroy(),
  )
  private readonly changeListeners = new Set<Listener<[string, BrowserState]>>()
  private readonly resourceRegistration: Disposable
  private readonly sessionCleanupRegistration: Disposable
  private readonly rendererRenderLeases = new Map<number, RendererRenderLease>()
  private recording?: ActiveRecording
  private destroyTask: Promise<void> | null = null
  private destroyed = false
  private readonly handleThemeUpdated = (): void => {
    const colorScheme = nativeTheme.shouldUseDarkColors ? "dark" : "light"
    this.managers.forEach((manager) => manager.setColorScheme(colorScheme))
  }

  constructor(
    private readonly window: BrowserWindow,
    private readonly resources: ResourceManager
  ) {
    this.resourceRegistration = resources.register('browser', (id, sessionId, options) =>
      this.openResource(id, sessionId, options as { url?: string } | undefined)
    )
    this.sessionCleanupRegistration = resources.registerSessionCleanup(async (sessionId) => {
      try {
        await this.stopRecordingForSession(sessionId)
      } finally {
        await this.managers.destroySession(sessionId)
      }
    })
    nativeTheme?.on("updated", this.handleThemeUpdated)
  }

  bindChange(callback: (sessionId: string, state: BrowserState) => void): () => void {
    return addListener(this.changeListeners, callback)
  }

  state(sessionId: string): BrowserState {
    return this.managers.peek(sessionId)?.state() ?? { tabs: [] }
  }

  tab(sessionId: string, id: number): BrowserTab | undefined {
    return this.managers.peek(sessionId)?.get(id)
  }

  attach(sessionId: string, id: number, contents: WebContents): void {
    const manager = this.managers.peek(sessionId)
    if (!manager) throw new Error("browser session not found")
    manager.attach(id, contents)
  }

  createTab(sessionId: string, url?: string): number {
    return this.resources.create('browser', sessionId, { url })
  }

  openUrl(sessionId: string, url: string): number {
    const target = resolveAddress(url)
    if (!target) throw new Error(`invalid url: ${url}`)
    const targetUrl = new URL(target)
    const targetHref = targetUrl.href
    targetUrl.hash = ""
    const key = targetUrl.href
    const manager = this.managers.peek(sessionId)
    if (!manager) return this.resources.create('browser', sessionId, { url: target })
    const existing = manager.state().tabs.find((tab) => {
      if (!manager.get(tab.id)) return false
      try {
        const tabUrl = new URL(tab.url)
        tabUrl.hash = ""
        return tabUrl.href === key
      } catch {
        return false
      }
    })
    if (!existing) return this.resources.create('browser', sessionId, { url: target })
    if (new URL(existing.url).href !== targetHref) manager.navigate(existing.id, targetHref)
    return existing.id
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
    return {
      dispose: async () => {
        let recordingError: unknown
        let closeError: unknown
        try {
          await this.stopRecordingForResource(sessionId, id)
        } catch (error) {
          recordingError = error
        }
        try {
          await manager.close(id)
        } catch (error) {
          closeError = error
        }
        await this.discardRendererRendering(id)
        if (recordingError && closeError) {
          throw new AggregateError(
            [recordingError, closeError],
            "failed to stop recording and close browser tab"
          )
        }
        if (closeError) throw closeError
        if (recordingError) throw recordingError
      }
    }
  }

  withTemporaryTab<T>(
    sessionId: string,
    url: string,
    callback: (tab: BrowserTab) => Promise<T>
  ): Promise<T> {
    return this.manager(sessionId).withTemporaryTab(url, callback)
  }

  async withRendered<T>(sessionId: string, id: number, operation: () => Promise<T>): Promise<T> {
    return this.manager(sessionId).withRendered(id, async () => {
      await this.acquireRendererRendering(id)
      try {
        return await operation()
      } finally {
        await this.releaseRendererRendering(id)
      }
    })
  }

  withUnthrottled<T>(sessionId: string, id: number, operation: () => Promise<T>): Promise<T> {
    return this.manager(sessionId).withUnthrottled(id, operation)
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

  async recordStart(sessionId: string, tab: BrowserTab, path: string): Promise<number> {
    await this.releaseStaleRecording()
    if (this.recording) throw new Error("another browser recording is already in progress")
    return this.beginRecording(sessionId, tab, path, false)
  }

  async recordStop(sessionId: string): Promise<{ path: string; bytes: number }> {
    const recording = this.recording
    if (recording?.sessionId !== sessionId) throw new Error("no recording in progress")
    recording.stopping = true
    const manager = this.managers.peek(sessionId)
    if (!manager) {
      await this.releaseRecording(recording)
      throw new Error("no recording in progress")
    }
    try {
      return await manager.recordStop()
    } finally {
      await this.releaseRecording(recording, manager)
    }
  }

  async recordStopIfCurrent(
    sessionId: string,
    generation: number
  ): Promise<{ path: string; bytes: number } | null> {
    const recording = this.recording
    if (recording?.sessionId !== sessionId || recording.generation !== generation) return null
    recording.stopping = true
    const manager = this.managers.peek(sessionId)
    if (!manager) {
      await this.releaseRecording(recording)
      return null
    }
    try {
      return await manager.recordStopIfCurrent(generation)
    } finally {
      await this.releaseRecording(recording, manager)
    }
  }

  async recordRestart(sessionId: string, tab: BrowserTab, path: string): Promise<number> {
    await this.releaseStaleRecording()
    if (this.recording && this.recording.sessionId !== sessionId) {
      throw new Error("another browser recording is already in progress")
    }
    return this.beginRecording(sessionId, tab, path, Boolean(this.recording))
  }

  private async releaseStaleRecording(): Promise<void> {
    const recording = this.recording
    if (!recording) return
    const manager = this.managers.peek(recording.sessionId)
    if (manager?.isRecording()) return
    await this.releaseRecording(recording, manager)
  }

  private async beginRecording(
    sessionId: string,
    tab: BrowserTab,
    path: string,
    restart: boolean
  ): Promise<number> {
    const manager = this.managers.peek(sessionId)
    if (!manager) throw new Error("browser session is not active")
    if (manager.get(tab.id) !== tab) throw new Error("browser tab not found")
    const previous = restart ? this.recording : undefined
    const movesToAnotherTab = previous !== undefined && previous.resourceId !== tab.id
    const inheritedRendererLease = !movesToAnotherTab && (previous?.rendererLease ?? false)
    if (inheritedRendererLease && previous) previous.rendererLease = false
    const claim: ActiveRecording = {
      generation: null,
      previous: movesToAnotherTab ? previous : undefined,
      rendererLease: inheritedRendererLease,
      resourceId: tab.id,
      sessionId,
      stopping: false
    }
    this.recording = claim
    let restartAttempted = false
    try {
      await tab.ready()
      if (this.recording !== claim || claim.stopping) {
        throw new Error("recording was cancelled during startup")
      }
      if (!claim.rendererLease) {
        await this.acquireRendererRendering(tab.id)
        claim.rendererLease = true
      }
      if (this.recording !== claim || claim.stopping) {
        throw new Error("recording was cancelled during startup")
      }
      manager.setRecording(tab.id)
      restartAttempted = restart
      const generation = restart
        ? await manager.recordRestart(tab, path)
        : await manager.recordStart(tab, path)
      if (this.recording !== claim || claim.stopping) {
        await manager.recordStopIfCurrent(generation)
        throw new Error("recording was cancelled during startup")
      }
      claim.generation = generation
      if (claim.previous) {
        await this.releaseRecordingLease(claim.previous)
        claim.previous = undefined
      }
      return generation
    } catch (error) {
      if (previous && !restartAttempted && this.recording === claim && !claim.stopping) {
        claim.previous = undefined
        this.recording = previous
        manager.setRecording(previous.resourceId)
        if (inheritedRendererLease) {
          claim.rendererLease = false
          previous.rendererLease = true
        } else {
          await this.releaseRecordingLease(claim)
        }
        throw error
      }
      if (this.recording === claim) {
        if (!claim.stopping) await this.releaseRecording(claim, manager)
      } else if (!this.recording || !this.recordingIncludesClaim(this.recording, claim)) {
        await this.releaseRecordingLease(claim)
      }
      throw error
    }
  }

  destroy(): Promise<void> {
    if (this.destroyTask) return this.destroyTask
    this.destroyed = true
    this.resourceRegistration.dispose()
    this.sessionCleanupRegistration.dispose()
    nativeTheme?.removeListener("updated", this.handleThemeUpdated)
    this.destroyTask = this.destroyResources()
    return this.destroyTask
  }

  private async destroyResources(): Promise<void> {
    const ids = this.resources.list({ type: 'browser' }).map(({ id }) => id)
    await Promise.allSettled(ids.map((id) => this.resources.close(id)))
    await this.managers.destroyAll()
    await Promise.allSettled(
      [...this.rendererRenderLeases.keys()].map((id) => this.setRendererRendering(id, false))
    )
    this.rendererRenderLeases.clear()
    this.recording = undefined
  }

  private async stopRecordingForResource(sessionId: string, resourceId: number): Promise<void> {
    if (
      this.recording?.sessionId !== sessionId ||
      !this.recordingIncludesResource(this.recording, resourceId)
    ) return
    await this.stopRecordingForSession(sessionId)
  }

  private recordingIncludesResource(recording: ActiveRecording, resourceId: number): boolean {
    for (let current: ActiveRecording | undefined = recording; current; current = current.previous) {
      if (current.resourceId === resourceId) return true
    }
    return false
  }

  private recordingIncludesClaim(recording: ActiveRecording, claim: ActiveRecording): boolean {
    for (let current: ActiveRecording | undefined = recording; current; current = current.previous) {
      if (current === claim) return true
    }
    return false
  }

  private async stopRecordingForSession(sessionId: string): Promise<void> {
    if (this.recording?.sessionId !== sessionId) return
    const recording = this.recording
    recording.stopping = true
    const manager = this.managers.peek(sessionId)
    try {
      if (manager && recording.generation !== null) {
        await manager.recordStopIfCurrent(recording.generation)
      } else if (manager) {
        try {
          await manager.recordStop()
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "no recording in progress") throw error
        }
      }
    } finally {
      await this.releaseRecording(recording, manager)
    }
  }

  private async releaseRecording(
    recording: ActiveRecording,
    manager?: BrowserTabManager
  ): Promise<void> {
    if (this.recording !== recording) return
    manager?.setRecording(null)
    this.recording = undefined
    await this.releaseRecordingLease(recording)
  }

  private async releaseRecordingLease(recording: ActiveRecording): Promise<void> {
    const previous = recording.previous
    recording.previous = undefined
    if (recording.rendererLease) {
      recording.rendererLease = false
      await this.releaseRendererRendering(recording.resourceId)
    }
    if (previous) await this.releaseRecordingLease(previous)
  }

  private async setRendererRendering(id: number, enabled: boolean): Promise<void> {
    if (this.window.isDestroyed?.() || !this.window.webContents?.executeJavaScript) return
    const selector = JSON.stringify(`[data-browser-webview-host="${id}"]`)
    await this.window.webContents
      .executeJavaScript(`(() => {
        const host = document.querySelector(${selector})
        if (!(host instanceof HTMLElement)) return true
        if (${enabled}) {
          host.dataset.browserRendering = 'true'
          if (host.dataset.active === 'true') return true
          host.style.left = '0px'
          host.style.top = '0px'
          host.style.zIndex = '-1'
          return new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
        }
        if (host.dataset.browserRendering === 'true') {
          delete host.dataset.browserRendering
          if (host.dataset.active === 'true') return true
          host.style.left = '-10000px'
          host.style.top = '-10000px'
          host.style.zIndex = ''
        }
        return true
      })()`)
      .catch(() => {})
  }

  private async acquireRendererRendering(id: number): Promise<void> {
    const existing = this.rendererRenderLeases.get(id)
    if (existing) {
      existing.count++
      await existing.ready
      return
    }
    const lease = { count: 1, ready: this.setRendererRendering(id, true) }
    this.rendererRenderLeases.set(id, lease)
    await lease.ready
  }

  private async releaseRendererRendering(id: number): Promise<void> {
    const lease = this.rendererRenderLeases.get(id)
    if (!lease) return
    lease.count--
    if (lease.count > 0) return
    this.rendererRenderLeases.delete(id)
    await this.setRendererRendering(id, false)
  }

  private async discardRendererRendering(id: number): Promise<void> {
    if (!this.rendererRenderLeases.delete(id)) return
    await this.setRendererRendering(id, false)
  }

  private manager(sessionId: string): BrowserTabManager {
    if (this.destroyed) throw new Error("browser service is destroyed")
    return this.managers.get(sessionId)
  }

  private createManager(sessionId: string): BrowserTabManager {
    const manager = new BrowserTabManager(
      (url) => {
        const resourceId = this.createTab(sessionId, url)
        this.window.webContents.send("resource:select", {
          rendererId: "browser",
          resourceId,
          sessionId
        })
      },
      nativeTheme?.shouldUseDarkColors ? "dark" : "light",
    )
    manager.bindChange((state) => {
      for (const listener of this.changeListeners) listener(sessionId, state)
    })
    return manager
  }
}
