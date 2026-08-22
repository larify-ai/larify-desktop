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

interface ActiveRecording {
  generation: number | null
  resourceId: number
  sessionId: string
  stopping: boolean
}

export class BrowserService {
  private readonly managers = new SessionScopedManagers(
    (sessionId) => this.createManager(sessionId),
    (manager: BrowserTabManager) => manager.destroy(),
  )
  private readonly changeListeners = new Set<Listener<[string, BrowserState]>>()
  private readonly resourceRegistration: Disposable
  private readonly sessionCleanupRegistration: Disposable
  private visibleResource?: { id: number; sessionId: string }
  private recording?: ActiveRecording
  private destroyTask: Promise<void> | null = null
  private destroyed = false

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
        try {
          await this.managers.destroySession(sessionId)
        } finally {
          if (this.visibleResource?.sessionId === sessionId) this.visibleResource = undefined
        }
      }
    })
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
      manager.createTab(id, options?.url, false)
    } catch (error) {
      if (!existingManager) void this.managers.destroySession(sessionId).catch(() => {})
      throw error
    }
    return {
      dispose: async () => {
        let recordingError: unknown
        try {
          await this.stopRecordingForResource(sessionId, id)
        } catch (error) {
          recordingError = error
        }
        try {
          await manager.close(id)
        } catch (closeError) {
          if (recordingError) {
            throw new AggregateError(
              [recordingError, closeError],
              "failed to stop recording and close browser tab"
            )
          }
          throw closeError
        } finally {
          if (this.visibleResource?.id === id) {
            manager.setVisible(false)
            this.visibleResource = undefined
          }
        }
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

  withRendered<T>(sessionId: string, id: number, operation: () => Promise<T>): Promise<T> {
    return this.manager(sessionId).withRendered(id, operation)
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
    if (this.recording) throw new Error("another browser recording is already in progress")
    return this.beginRecording(sessionId, tab, path, false)
  }

  async recordStop(sessionId: string): Promise<{ path: string; bytes: number }> {
    const recording = this.recording
    if (recording?.sessionId !== sessionId) throw new Error("no recording in progress")
    recording.stopping = true
    const manager = this.managers.peek(sessionId)
    if (!manager) {
      this.releaseRecording(recording)
      throw new Error("no recording in progress")
    }
    try {
      return await manager.recordStop()
    } finally {
      this.releaseRecording(recording, manager)
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
      this.releaseRecording(recording)
      return null
    }
    try {
      return await manager.recordStopIfCurrent(generation)
    } finally {
      this.releaseRecording(recording, manager)
    }
  }

  async recordRestart(sessionId: string, tab: BrowserTab, path: string): Promise<number> {
    if (this.recording && this.recording.sessionId !== sessionId) {
      throw new Error("another browser recording is already in progress")
    }
    return this.beginRecording(sessionId, tab, path, Boolean(this.recording))
  }

  private async beginRecording(
    sessionId: string,
    tab: BrowserTab,
    path: string,
    restart: boolean
  ): Promise<number> {
    const manager = this.managers.peek(sessionId)
    if (!manager) throw new Error("browser session is not active")
    const claim: ActiveRecording = { generation: null, resourceId: tab.id, sessionId, stopping: false }
    this.recording = claim
    manager.setRecording(tab.id)
    try {
      const generation = restart
        ? await manager.recordRestart(tab, path)
        : await manager.recordStart(tab, path)
      if (this.recording !== claim || claim.stopping) {
        await manager.recordStopIfCurrent(generation)
        throw new Error("recording was cancelled during startup")
      }
      claim.generation = generation
      return generation
    } catch (error) {
      if (!claim.stopping) this.releaseRecording(claim, manager)
      throw error
    }
  }

  setBounds(
    sessionId: string,
    id: number,
    bounds: Rectangle,
    live = false,
    activate = false
  ): boolean {
    const manager = this.managers.peek(sessionId)
    if (activate) manager?.setActive(id)
    if (!manager?.isActive(id)) return false
    manager.setBounds(bounds, live)
    return true
  }

  setVisible(sessionId: string, id: number, visible: boolean): void {
    if (!visible) {
      if (this.visibleResource?.id === id) {
        this.managers.peek(this.visibleResource.sessionId)?.setVisible(false)
        this.visibleResource = undefined
        return
      }
      const manager = this.managers.peek(sessionId)
      if (!manager?.isActive(id)) return
      manager.setVisible(false)
      if (this.visibleResource?.sessionId === sessionId) this.visibleResource = undefined
      return
    }
    const resource = this.resources.get(id)
    const manager = this.managers.peek(sessionId)
    if (resource?.type !== 'browser' || resource.sessionId !== sessionId || !manager) return
    if (this.visibleResource?.id === id) return
    const sessionAlreadyVisible = this.visibleResource?.sessionId === sessionId
    this.managers.forEach((manager, managerSessionId) => {
      if (managerSessionId !== sessionId) manager.setVisible(false)
    })
    this.visibleResource = { id, sessionId }
    manager.setActive(id)
    if (!sessionAlreadyVisible) manager.setVisible(true)
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
    this.recording = undefined
  }

  private async stopRecordingForResource(sessionId: string, resourceId: number): Promise<void> {
    if (this.recording?.sessionId !== sessionId || this.recording.resourceId !== resourceId) return
    await this.stopRecordingForSession(sessionId)
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
      this.releaseRecording(recording, manager)
    }
  }

  private releaseRecording(
    recording: ActiveRecording,
    manager?: BrowserTabManager
  ): void {
    if (this.recording !== recording) return
    manager?.setRecording(null)
    this.recording = undefined
  }

  private manager(sessionId: string): BrowserTabManager {
    if (this.destroyed) throw new Error("browser service is destroyed")
    return this.managers.get(sessionId)
  }

  private createManager(sessionId: string): BrowserTabManager {
    const manager = new BrowserTabManager(this.window, (url) => {
      const resourceId = this.createTab(sessionId, url)
      this.window.webContents.send("resource:select", {
        rendererId: "browser",
        resourceId,
        sessionId
      })
    })
    manager.bindChange((state) => {
      for (const listener of this.changeListeners) listener(sessionId, state)
    })
    return manager
  }
}
