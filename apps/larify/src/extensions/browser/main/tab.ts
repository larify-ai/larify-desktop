import { WebContentsView } from "electron"
import type { Debugger, DownloadItem, WebContents } from "electron"
import { normalize } from "node:path"
import type { BrowserTabError, BrowserTabState } from "../shared/types"
import { faviconDataUrl, faviconOriginFallback } from "./favicon"
import { normalizeUrl } from "./url"
import type { RefEntry } from "./snapshot"
import { captureSnapshot, type CaptureOptions, type CdpSend } from "./snapshotCapture"
import { FrameSessions } from "./frameSessions"
import { CdpEventBuffer, type CdpEvent } from "./cdpEventBuffer"
import {
  ConsoleBuffer,
  parseConsoleEvent,
  parseExceptionEvent,
  type ConsoleEntry,
  type ErrorEntry,
} from "./consoleBuffer"
import * as interactions from "./interactions"
import type { Interactions } from "./interactions"
import * as queries from "./queries"
import type { Box } from "./queries"
import { htmlToMarkdown } from "./read"
import * as input from "./input"
import { newMouseState, type MouseButton } from "./input"
import * as waits from "./waits"
import type { WaitState } from "./waits"
import { screenshot, type ScreenshotOptions, type ScreenshotResult } from "./capture"
import { parseKeyChord } from "./keymap"

const DIALOG_OVERRIDE =
  "window.alert=function(){};window.confirm=function(){return true;};window.prompt=function(){return null;};"

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return true
  }
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 30000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`CDP command timed out after ${waits.formatTimeout(timeoutMs)}: ${label}`)),
      timeoutMs,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function waitForWebContentsLoadEvent(wc: WebContents, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      wc.off("did-finish-load", finish)
      wc.off("did-fail-load", onFail)
      resolve()
    }
    const onFail = (
      _event: unknown,
      _code: number,
      _description: string,
      _url: string,
      isMainFrame: boolean,
    ): void => {
      if (isMainFrame) finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    wc.on("did-finish-load", finish)
    wc.on("did-fail-load", onFail)
  })
}

function waitForWebContentsNotLoading(wc: WebContents, timeoutMs = 30000, stableMs = 100): Promise<void> {
  return new Promise((resolve) => {
    let stable: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      clearTimeout(deadline)
      if (stable) clearTimeout(stable)
      wc.off("did-start-loading", check)
      wc.off("did-stop-loading", check)
    }
    const finish = (): void => {
      cleanup()
      resolve()
    }
    const check = (): void => {
      if (stable) {
        clearTimeout(stable)
        stable = undefined
      }
      if (!wc.isLoading()) stable = setTimeout(finish, stableMs)
    }
    const deadline = setTimeout(finish, timeoutMs)
    wc.on("did-start-loading", check)
    wc.on("did-stop-loading", check)
    check()
  })
}

async function waitForWebContentsLoad(wc: WebContents, timeoutMs = 30000): Promise<void> {
  await waitForWebContentsLoadEvent(wc, timeoutMs)
  await waitForWebContentsNotLoading(wc, timeoutMs)
}

export class BrowserTab {
  readonly id: number
  readonly view: WebContentsView
  private currentUrl = ""
  private pendingUrl = ""
  private navigationTask: Promise<void> | null = null
  private favIconUrl = ""
  private favIconRequest = 0
  private error: BrowserTabError | null = null
  private onChange?: () => void
  private readonly cdpBuffer = new CdpEventBuffer()
  private readonly consoleBuffer = new ConsoleBuffer()
  private readonly cdpReady: Promise<void>
  private refMap = new Map<string, RefEntry>()
  private nextRef = 1
  private readonly frames = new FrameSessions()
  private readonly mouseState = newMouseState()
  private readonly cdpSend: CdpSend = (method, params, sessionId) =>
    this.sendCdp(method, params, sessionId)

  constructor(id: number, partition: string) {
    this.id = id
    this.view = new WebContentsView({
      webPreferences: { partition, backgroundThrottling: false },
    })
    this.wireEvents()
    const blankReady = this.view.webContents.loadURL("about:blank").catch(() => {})
    this.cdpReady = this.initCdp(blankReady)
  }

  bindChange(cb: () => void): void {
    this.onChange = cb
  }

  navigate(url: string): boolean {
    const target = normalizeUrl(url)
    if (!target) return false
    void this.startNavigation(target)
    return true
  }

  goBack(): void {
    if (this.view.webContents.navigationHistory.canGoBack()) {
      this.view.webContents.navigationHistory.goBack()
    }
  }

  goForward(): void {
    if (this.view.webContents.navigationHistory.canGoForward()) {
      this.view.webContents.navigationHistory.goForward()
    }
  }

  reload(): void {
    this.view.webContents.reload()
  }

  async navigateAndWait(url: string): Promise<void> {
    const target = normalizeUrl(url)
    if (!target) throw new Error(`invalid url: ${url}`)
    await this.startNavigation(target)
  }

  async waitForNavigation(): Promise<void> {
    await this.navigationTask
  }

  private startNavigation(target: string): Promise<void> {
    this.pendingUrl = target
    this.onChange?.()
    const task = this.cdpReady.then(async () => {
      const loaded = waitForWebContentsLoad(this.view.webContents)
      try {
        await this.view.webContents.loadURL(target)
      } catch {
        // load failure is captured in state via did-fail-load
      }
      await loaded
      if (this.pendingUrl === target) {
        this.pendingUrl = ""
        this.onChange?.()
      }
    })
    const navigationTask = task.finally(() => {
      if (this.navigationTask === navigationTask) this.navigationTask = null
    })
    this.navigationTask = navigationTask
    return navigationTask
  }

  async goBackAndWait(): Promise<void> {
    const wc = this.view.webContents
    if (!wc.navigationHistory.canGoBack()) return
    const loaded = waitForWebContentsLoad(wc)
    wc.navigationHistory.goBack()
    await loaded
  }

  async goForwardAndWait(): Promise<void> {
    const wc = this.view.webContents
    if (!wc.navigationHistory.canGoForward()) return
    const loaded = waitForWebContentsLoad(wc)
    wc.navigationHistory.goForward()
    await loaded
  }

  async reloadAndWait(): Promise<void> {
    const wc = this.view.webContents
    const loaded = waitForWebContentsLoad(wc)
    wc.reload()
    await loaded
  }

  state(): BrowserTabState {
    const wc = this.view.webContents
    const url = wc.getURL()
    const isBlank = !url || url === "about:blank"
    const displayUrl = isBlank ? this.pendingUrl : url
    return {
      id: this.id,
      url: displayUrl,
      title: isBlank ? "" : wc.getTitle(),
      favIconUrl: this.favIconUrl,
      loading: wc.isLoading() || Boolean(this.pendingUrl),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: this.error,
    }
  }

  destroy(): void {
    const dbg = this.view.webContents.debugger
    if (dbg?.isAttached()) dbg.detach()
    this.view.webContents.close()
  }

  async sendCdp(
    method: string,
    params?: object,
    sessionId?: string,
    timeoutMs = 30000,
  ): Promise<unknown> {
    await this.cdpReady
    const dbg = this.view.webContents.debugger
    if (!dbg.isAttached()) {
      dbg.attach()
      await this.setupAutoAttach(dbg)
    }
    return withTimeout(dbg.sendCommand(method, params ?? {}, sessionId), method, timeoutMs)
  }

  async evalJs(script: string, sessionId?: string): Promise<unknown> {
    const res = (await this.sendCdp(
      "Runtime.evaluate",
      { expression: `(${script})()`, returnByValue: true, awaitPromise: true },
      sessionId,
    )) as {
      result?: { value?: unknown }
      exceptionDetails?: { exception?: { description?: string }; text?: string }
    }
    if (res.exceptionDetails) {
      const details = res.exceptionDetails
      throw new Error(details.exception?.description ?? details.text ?? "eval failed")
    }
    return res.result?.value
  }

  async snapshot(opts: CaptureOptions = {}): Promise<string> {
    const url = this.view.webContents.getURL()
    if (!url || url === "about:blank") {
      throw new Error("cannot snapshot a blank tab: navigate to a page first")
    }
    const { text, nextRef } = await captureSnapshot(
      (method, params, sessionId) => this.sendCdp(method, params, sessionId),
      this.refMap,
      this.nextRef,
      opts,
      this.frames.asMap(),
    )
    this.nextRef = nextRef
    return text
  }

  async click(selector: string, button: MouseButton = "left"): Promise<void> {
    await interactions.click(this.interactCtx(), selector, button)
  }

  async elementHref(selector: string): Promise<string> {
    return interactions.elementHref(this.interactCtx(), selector)
  }

  async dblclick(selector: string): Promise<void> {
    await interactions.dblclick(this.interactCtx(), selector)
  }

  async hover(selector: string): Promise<void> {
    await interactions.hover(this.interactCtx(), selector)
  }

  async fill(selector: string, text: string): Promise<void> {
    await interactions.fill(this.interactCtx(), selector, text)
  }

  async type(selector: string, text: string, clear = false, delayMs = 0): Promise<void> {
    await interactions.type(this.interactCtx(), selector, text, clear, delayMs)
  }

  async press(key: string): Promise<void> {
    await interactions.press(this.interactCtx(), key)
  }

  async focus(selector: string): Promise<void> {
    await interactions.focus(this.interactCtx(), selector)
  }

  async check(selector: string): Promise<void> {
    await interactions.check(this.interactCtx(), selector)
  }

  async uncheck(selector: string): Promise<void> {
    await interactions.uncheck(this.interactCtx(), selector)
  }

  async select(selector: string, values: string[]): Promise<void> {
    await interactions.select(this.interactCtx(), selector, values)
  }

  async scroll(
    selector?: string,
    direction: "up" | "down" | "left" | "right" = "down",
    amount = 300,
  ): Promise<void> {
    await interactions.scroll(this.interactCtx(), selector, direction, amount)
  }

  async scrollIntoView(selector: string): Promise<void> {
    await interactions.scrollIntoView(this.interactCtx(), selector)
  }

  async drag(source: string, target: string): Promise<void> {
    await interactions.drag(this.interactCtx(), source, target)
  }

  async highlight(selector: string): Promise<void> {
    await interactions.highlight(this.interactCtx(), selector)
  }

  async upload(selector: string, files: string[]): Promise<void> {
    await interactions.upload(this.interactCtx(), selector, files)
  }

  async download(selector: string, path: string, timeoutMs = 1_800_000): Promise<string> {
    const wc = this.view.webContents
    const done = new Promise<string>((resolve, reject) => {
      let started = false
      const timer = setTimeout(() => {
        wc.session.off("will-download", onWillDownload)
        reject(
          new Error(
            started
              ? `download did not finish within ${waits.formatTimeout(timeoutMs)}`
              : `download did not start within ${waits.formatTimeout(timeoutMs)}`,
          ),
        )
      }, timeoutMs)
      const onWillDownload = (_event: unknown, item: DownloadItem): void => {
        started = true
        wc.session.off("will-download", onWillDownload)
        item.setSavePath(normalize(path))
        item.once("done", (_doneEvent, state) => {
          clearTimeout(timer)
          if (state === "completed") resolve(item.getSavePath())
          else reject(new Error(`download failed: ${state}`))
        })
      }
      wc.session.on("will-download", onWillDownload)
    })
    await interactions.click(this.interactCtx(), selector)
    return done
  }

  async getText(selector: string): Promise<string> {
    return queries.getText(this.interactCtx(), selector)
  }

  async getHtml(selector: string): Promise<string> {
    return queries.getHtml(this.interactCtx(), selector)
  }

  async getValue(selector: string): Promise<string> {
    return queries.getValue(this.interactCtx(), selector)
  }

  async getAttr(selector: string, name: string): Promise<string | null> {
    return queries.getAttr(this.interactCtx(), selector, name)
  }

  async getBox(selector: string): Promise<Box> {
    return queries.getBox(this.interactCtx(), selector)
  }

  async getStyles(selector: string, properties?: string[]): Promise<Record<string, string>> {
    return queries.getStyles(this.interactCtx(), selector, properties)
  }

  async getCount(selector: string): Promise<number> {
    return queries.getCount(this.interactCtx(), selector)
  }

  async isVisible(selector: string): Promise<boolean> {
    return queries.isVisible(this.interactCtx(), selector)
  }

  async isEnabled(selector: string): Promise<boolean> {
    return queries.isEnabled(this.interactCtx(), selector)
  }

  async isChecked(selector: string): Promise<boolean> {
    return queries.isChecked(this.interactCtx(), selector)
  }

  async keyDown(key: string): Promise<void> {
    const { modifiers, info } = parseKeyChord(key)
    await input.keyDown(this.cdpSend, info, modifiers)
  }

  async keyUp(key: string): Promise<void> {
    const { modifiers, info } = parseKeyChord(key)
    await input.keyUp(this.cdpSend, info, modifiers)
  }

  async keyboardType(text: string): Promise<void> {
    await input.typeText(this.cdpSend, text)
  }

  async keyboardInsertText(text: string): Promise<void> {
    await input.insertText(this.cdpSend, text)
  }

  async mouseMove(x: number, y: number): Promise<void> {
    await input.mouseMove(this.cdpSend, this.mouseState, x, y)
  }

  async mouseDown(button: MouseButton = "left"): Promise<void> {
    await input.mouseDown(this.cdpSend, this.mouseState, button)
  }

  async mouseUp(button: MouseButton = "left"): Promise<void> {
    await input.mouseUp(this.cdpSend, this.mouseState, button)
  }

  async mouseWheel(deltaX: number, deltaY: number): Promise<void> {
    await input.mouseWheel(this.cdpSend, this.mouseState, deltaX, deltaY)
  }

  async waitForSelector(selector: string, state?: WaitState, timeoutMs?: number): Promise<void> {
    await waits.waitForSelector(this.cdpSend, selector, state, timeoutMs)
  }

  async waitForText(text: string, timeoutMs?: number): Promise<void> {
    await waits.waitForText(this.cdpSend, text, timeoutMs)
  }

  async waitForFunction(expression: string, timeoutMs?: number): Promise<void> {
    await waits.waitForFunction(this.cdpSend, expression, timeoutMs)
  }

  async waitForUrl(pattern: string, timeoutMs?: number): Promise<void> {
    await waits.waitForUrl(this.cdpSend, pattern, timeoutMs)
  }

  async waitForLoad(
    state: "load" | "domcontentloaded" | "networkidle" = "load",
    timeoutMs = 25000,
  ): Promise<void> {
    if (state === "networkidle") return this.waitForNetworkIdle(timeoutMs)
    const wc = this.view.webContents
    if (!wc.isLoading()) return
    const arrival = new Promise<void>((resolve) => {
      if (state === "domcontentloaded") wc.once("dom-ready", () => resolve())
      else wc.once("did-finish-load", () => resolve())
    })
    await withTimeout(arrival, `wait_for_load ${state}`, timeoutMs)
  }

  async screenshot(opts: ScreenshotOptions): Promise<ScreenshotResult> {
    return screenshot(this.interactCtx(), opts)
  }

  async pdf(): Promise<Buffer> {
    return this.view.webContents.printToPDF({ printBackground: true })
  }

  async read(): Promise<{ url: string; title?: string; content: string }> {
    const res = (await this.sendCdp("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    })) as { result?: { value?: unknown } }
    const html = typeof res.result?.value === "string" ? res.result.value : ""
    const sourceUrl = this.view.webContents.getURL()
    const { title, markdown } = await htmlToMarkdown(html, sourceUrl)
    return { url: sourceUrl, title, content: markdown }
  }

  drainCdpEvents(filter?: string): { events: CdpEvent[]; dropped: number } {
    return this.cdpBuffer.drain(filter)
  }

  readConsole(opts: {
    level?: string
    limit?: number
    clear?: boolean
  }): { entries: ConsoleEntry[]; dropped: number } {
    return this.consoleBuffer.readConsole(opts)
  }

  readErrors(opts: { clear?: boolean }): { entries: ErrorEntry[]; dropped: number } {
    return this.consoleBuffer.readErrors(opts)
  }

  private wireEvents(): void {
    const wc = this.view.webContents
    const emit = (): void => this.onChange?.()
    const syncUrl = (): void => {
      this.currentUrl = wc.getURL()
      this.pendingUrl = ""
      emit()
    }

    wc.on("will-prevent-unload", (event) => event.preventDefault())
    wc.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      this.error = null
      this.resetPageState()
      if (!sameOrigin(details.url, this.currentUrl)) this.favIconUrl = ""
      emit()
    })
    wc.on("did-navigate", syncUrl)
    wc.on("did-navigate-in-page", syncUrl)
    wc.on("page-title-updated", emit)
    wc.on("page-favicon-updated", (_event, favicons) => {
      void this.setFavIcon(favicons)
      emit()
    })
    wc.on("did-start-loading", emit)
    wc.on("did-stop-loading", emit)
    wc.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      this.pendingUrl = ""
      this.error = { code: errorCode, description: errorDescription }
      emit()
    })
    wc.on("render-process-gone", (_event, details) => {
      this.error = { code: -1, description: `render process gone: ${details.reason}` }
      this.resetPageState()
      emit()
    })
  }

  private async initCdp(blankReady: Promise<void>): Promise<void> {
    try {
      const dbg = this.view.webContents.debugger
      if (!dbg.isAttached()) dbg.attach()
      dbg.on("message", (_event, eventMethod, eventParams, eventSessionId) => {
        try {
          if (this.handleTargetEvent(dbg, eventMethod, eventParams, eventSessionId || undefined)) {
            return
          }
          if (this.handleConsoleEvent(eventMethod, eventParams)) return
          this.cdpBuffer.push({
            method: eventMethod,
            params: eventParams,
            sessionId: eventSessionId || undefined,
          })
        } catch {
          // never let event buffering disrupt the debugger message pump
        }
      })
      await this.setupAutoAttach(dbg)
      await blankReady
      await dbg.sendCommand("Page.enable").catch(() => {})
      await dbg.sendCommand("Runtime.enable").catch(() => {})
      await dbg
        .sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: DIALOG_OVERRIDE })
        .catch(() => {})
    } catch {
      // best-effort; a broken debugger surfaces later at sendCdp
    }
  }

  private async setupAutoAttach(dbg: Debugger): Promise<void> {
    await dbg
      .sendCommand("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      })
      .catch(() => {})
    await dbg.sendCommand("Target.setDiscoverTargets", { discover: true }).catch(() => {})
  }

  private handleTargetEvent(
    dbg: Debugger,
    method: string,
    params: unknown,
    sessionId?: string,
  ): boolean {
    if (method === "Target.attachedToTarget") {
      const sid = this.frames.attached(params)
      if (sid) {
        dbg.sendCommand("Runtime.runIfWaitingForDebugger", {}, sid).catch(() => {})
        dbg.sendCommand("DOM.enable", {}, sid).catch(() => {})
        dbg.sendCommand("Accessibility.enable", {}, sid).catch(() => {})
      }
      return true
    }
    if (method === "Target.detachedFromTarget") {
      this.frames.detached(params)
      return true
    }
    if (method === "Page.javascriptDialogOpening") {
      this.sendCdp("Page.handleJavaScriptDialog", { accept: true }, sessionId).catch(() => {})
      return true
    }
    return false
  }

  private handleConsoleEvent(method: string, params: unknown): boolean {
    if (method === "Runtime.consoleAPICalled") {
      this.consoleBuffer.addConsole(parseConsoleEvent(params as Parameters<typeof parseConsoleEvent>[0]))
      return true
    }
    if (method === "Runtime.exceptionThrown") {
      this.consoleBuffer.addError(parseExceptionEvent(params as Parameters<typeof parseExceptionEvent>[0]))
      return true
    }
    return (
      method === "Runtime.executionContextCreated" ||
      method === "Runtime.executionContextDestroyed" ||
      method === "Runtime.executionContextsCleared"
    )
  }

  private interactCtx(): Interactions {
    return {
      send: (method, params, sessionId) => this.sendCdp(method, params, sessionId),
      refMap: this.refMap,
      sessions: this.frames.asMap(),
    }
  }

  private async waitForNetworkIdle(timeoutMs: number): Promise<void> {
    await this.cdpReady
    const dbg = this.view.webContents.debugger
    const pending = new Set<string>()
    return new Promise<void>((resolve, reject) => {
      let idle: ReturnType<typeof setTimeout> | null = null
      let settled = false
      const cleanup = (): void => {
        clearTimeout(deadline)
        if (idle) clearTimeout(idle)
        dbg.off("message", onMessage)
      }
      const arm = (): void => {
        if (idle) clearTimeout(idle)
        idle = setTimeout(() => {
          if (settled) return
          settled = true
          cleanup()
          resolve()
        }, 500)
      }
      const onMessage = (_event: unknown, method: string, params: { requestId?: string }): void => {
        if (method === "Network.requestWillBeSent") {
          if (params.requestId) pending.add(params.requestId)
          if (idle) {
            clearTimeout(idle)
            idle = null
          }
        } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
          if (params.requestId) pending.delete(params.requestId)
          if (pending.size === 0) arm()
        }
      }
      const deadline = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(`wait_for_load networkidle timed out after ${waits.formatTimeout(timeoutMs)}`))
      }, timeoutMs)
      dbg
        .sendCommand("Network.enable")
        .catch(() => {})
        .finally(() => {
          if (settled) return
          dbg.on("message", onMessage)
          arm()
        })
    })
  }

  private resetPageState(): void {
    this.refMap.clear()
    this.nextRef = 1
    this.frames.clear()
  }

  private async setFavIcon(favicons: string[]): Promise<void> {
    const wc = this.view.webContents
    const pageUrl = wc.getURL()
    const sourceUrl = favicons.at(-1) ?? ""
    const request = ++this.favIconRequest
    if (!sourceUrl) return

    const dataUrl = await faviconDataUrl(sourceUrl)
    if (request !== this.favIconRequest || wc.getURL() !== pageUrl) return
    if (dataUrl) {
      this.favIconUrl = dataUrl
      this.onChange?.()
      return
    }

    const fallbackUrl = faviconOriginFallback(pageUrl)
    if (!fallbackUrl || fallbackUrl === sourceUrl) return
    const fallbackDataUrl = await faviconDataUrl(fallbackUrl)
    if (request !== this.favIconRequest || wc.getURL() !== pageUrl || !fallbackDataUrl) return
    this.favIconUrl = fallbackDataUrl
    this.onChange?.()
  }
}
