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
import { modifierBitForKey, parseKeyChord } from "./keymap"

const DIALOG_OVERRIDE =
  "window.alert=function(){};window.confirm=function(){return true;};window.prompt=function(){return null;};"
const DOWNLOAD_CANCEL_CONFIRM_TIMEOUT = 5000
const NAVIGATION_TIMEOUT = 60000

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return true
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 30000,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error(`CDP command was cancelled: ${label}`))
  let timer: ReturnType<typeof setTimeout>
  let onAbort: (() => void) | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`CDP command timed out after ${waits.formatTimeout(timeoutMs)}: ${label}`)),
      timeoutMs,
    )
  })
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return
    onAbort = () => reject(new Error(`CDP command was cancelled: ${label}`))
    signal.addEventListener("abort", onAbort, { once: true })
  })
  return Promise.race([promise, timeout, aborted]).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener("abort", onAbort)
  })
}

function waitForWebContentsLoadEvent(
  wc: WebContents,
  timeoutMs = NAVIGATION_TIMEOUT,
  acceptsFailedUrl?: (url: string) => boolean,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.off("did-finish-load", finish)
      wc.off("did-stop-loading", finish)
      wc.off("did-navigate", onNavigate)
      wc.off("did-fail-load", onFail)
      wc.off("destroyed", onDestroyed)
      signal?.removeEventListener("abort", onAbort)
    }
    const finish = (): void => {
      cleanup()
      resolve()
    }
    const onNavigate = (_event: unknown, url: string): void => {
      if (typeof url !== "string") return
      const normalized = normalizeUrl(url) ?? url
      if (acceptsFailedUrl && !acceptsFailedUrl(normalized)) return
      finish()
    }
    const onFail = (
      _event: unknown,
      code: number,
      description: string,
      url: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame) return
      if (url && acceptsFailedUrl && !acceptsFailedUrl(normalizeUrl(url) ?? url)) return
      cleanup()
      reject(new Error(`navigation failed (${code}): ${description}${url ? `: ${url}` : ""}`))
    }
    const onDestroyed = (): void => {
      cleanup()
      reject(new Error("tab was closed during navigation"))
    }
    const onAbort = (): void => {
      cleanup()
      reject(new Error("navigation wait was cancelled"))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`navigation load event timed out after ${waits.formatTimeout(timeoutMs)}`))
    }, timeoutMs)
    wc.on("did-finish-load", finish)
    wc.on("did-stop-loading", finish)
    // Chromium's built-in viewers (notably PDF) can replace the document
    // without emitting the normal page load events on the outer WebContents.
    wc.on("did-navigate", onNavigate)
    wc.on("did-fail-load", onFail)
    wc.once("destroyed", onDestroyed)
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

function waitForWebContentsNotLoading(
  wc: WebContents,
  timeoutMs = NAVIGATION_TIMEOUT,
  stableMs = 100,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stable: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      clearTimeout(deadline)
      if (stable) clearTimeout(stable)
      wc.off("did-start-loading", check)
      wc.off("did-stop-loading", check)
      wc.off("destroyed", onDestroyed)
      signal?.removeEventListener("abort", onAbort)
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
    const onDestroyed = (): void => {
      cleanup()
      reject(new Error("tab was closed during navigation"))
    }
    const onAbort = (): void => {
      cleanup()
      reject(new Error("navigation wait was cancelled"))
    }
    const deadline = setTimeout(() => {
      cleanup()
      reject(new Error(`navigation loading state timed out after ${waits.formatTimeout(timeoutMs)}`))
    }, timeoutMs)
    wc.on("did-start-loading", check)
    wc.on("did-stop-loading", check)
    wc.once("destroyed", onDestroyed)
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    check()
  })
}

async function waitForWebContentsLoad(
  wc: WebContents,
  timeoutMs = NAVIGATION_TIMEOUT,
  acceptsFailedUrl?: (url: string) => boolean,
  signal?: AbortSignal,
): Promise<void> {
  await waitForWebContentsLoadEvent(wc, timeoutMs, acceptsFailedUrl, signal)
  await waitForWebContentsNotLoading(wc, timeoutMs, 100, signal)
}

function evalJsExpression(script: string): string {
  const source = JSON.stringify(script)
  return [
    "(async () => {",
    `const source = ${source}`,
    "const value = eval('(' + source + ')')",
    "return typeof value === 'function' ? await value() : value",
    "})()",
  ].join("\n")
}

interface BrowserTabOptions {
  automation?: boolean
}

export class BrowserTab {
  readonly id: number
  readonly view: WebContentsView
  private currentUrl = ""
  private pendingUrl = ""
  private navigationTask: Promise<void> | null = null
  private navigationGeneration = 0
  private readonly activeNavigationUrls = new Set<string>()
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
  private keyboardModifiers = 0
  private inputTask = Promise.resolve()
  private readonly pendingNetworkRequests = new Set<string>()
  private readonly networkWaiters = new Set<() => void>()
  private readonly cancelDownloads = new Set<(error: Error) => void>()
  private downloadActive = false
  private destroyed = false
  private readonly cdpSend: CdpSend = (method, params, sessionId) =>
    this.sendCdp(method, params, sessionId)

  constructor(id: number, partition: string, { automation = true }: BrowserTabOptions = {}) {
    this.id = id
    this.view = new WebContentsView({
      webPreferences: { partition, backgroundThrottling: true },
    })
    this.wireEvents()
    if (automation) {
      const blankReady = this.view.webContents.loadURL("about:blank").catch(() => {})
      this.cdpReady = this.initCdp(blankReady)
    } else {
      this.cdpReady = Promise.resolve()
    }
  }

  bindChange(cb: () => void): void {
    this.onChange = cb
  }

  navigate(url: string): boolean {
    const target = normalizeUrl(url)
    if (!target) return false
    const task = this.startNavigation(target)
    const generation = this.navigationGeneration
    void task.catch((error) => {
      if (generation === this.navigationGeneration && this.pendingUrl === target) {
        this.pendingUrl = ""
        this.error = {
          code: -1,
          description: error instanceof Error ? error.message : String(error),
        }
        this.onChange?.()
      }
    })
    return true
  }

  goBack(): void {
    if (this.view.webContents.navigationHistory.canGoBack()) {
      this.runNavigationAction(() => this.view.webContents.navigationHistory.goBack())
    }
  }

  goForward(): void {
    if (this.view.webContents.navigationHistory.canGoForward()) {
      this.runNavigationAction(() => this.view.webContents.navigationHistory.goForward())
    }
  }

  reload(): void {
    this.runNavigationAction(() => this.view.webContents.reload())
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
    const generation = this.beginNavigation(target)
    this.pendingUrl = target
    this.onChange?.()
    const task = this.cdpReady.then(async () => {
      const loaded = waitForWebContentsLoad(
        this.view.webContents,
        NAVIGATION_TIMEOUT,
        (url) => this.activeNavigationUrls.has(url),
      )
      await Promise.all([
        this.view.webContents.loadURL(target).catch(() => {
          // load failure is captured in state via did-fail-load
        }),
        loaded,
      ])
      this.assertNavigationCurrent(generation, target)
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
    const waitController = new AbortController()
    const loaded = waitForWebContentsLoad(wc, NAVIGATION_TIMEOUT, undefined, waitController.signal)
    let generation: number
    try {
      generation = this.runNavigationAction(() => wc.navigationHistory.goBack())
    } catch (error) {
      waitController.abort()
      await loaded.catch(() => {})
      throw error
    }
    await loaded
    this.assertNavigationCurrent(generation)
  }

  async goForwardAndWait(): Promise<void> {
    const wc = this.view.webContents
    if (!wc.navigationHistory.canGoForward()) return
    const waitController = new AbortController()
    const loaded = waitForWebContentsLoad(wc, NAVIGATION_TIMEOUT, undefined, waitController.signal)
    let generation: number
    try {
      generation = this.runNavigationAction(() => wc.navigationHistory.goForward())
    } catch (error) {
      waitController.abort()
      await loaded.catch(() => {})
      throw error
    }
    await loaded
    this.assertNavigationCurrent(generation)
  }

  async reloadAndWait(): Promise<void> {
    const wc = this.view.webContents
    const waitController = new AbortController()
    const loaded = waitForWebContentsLoad(wc, NAVIGATION_TIMEOUT, undefined, waitController.signal)
    let generation: number
    try {
      generation = this.runNavigationAction(() => wc.reload())
    } catch (error) {
      waitController.abort()
      await loaded.catch(() => {})
      throw error
    }
    await loaded
    this.assertNavigationCurrent(generation)
  }

  private runNavigationAction(action: () => void): number {
    const generation = this.beginNavigation()
    action()
    return generation
  }

  private beginNavigation(expectedUrl?: string): number {
    const generation = ++this.navigationGeneration
    this.activeNavigationUrls.clear()
    if (expectedUrl) this.activeNavigationUrls.add(expectedUrl)
    return generation
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
    if (this.destroyed) return
    this.destroyed = true
    const error = new Error("tab was closed during download")
    for (const cancel of [...this.cancelDownloads]) cancel(error)
    const wc = this.view.webContents
    if (wc.isDestroyed()) return
    const dbg = wc.debugger
    if (dbg?.isAttached()) dbg.detach()
    wc.close()
  }

  async sendCdp(
    method: string,
    params?: object,
    sessionId?: string,
    timeoutMs = 30000,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const wc = this.view.webContents
    const throwIfCancelled = (): void => {
      if (signal?.aborted) throw new Error(`CDP command was cancelled: ${method}`)
      if (this.destroyed || wc.isDestroyed())
        throw new Error(`tab was closed before CDP command: ${method}`)
    }
    throwIfCancelled()
    await this.cdpReady
    throwIfCancelled()
    const dbg = wc.debugger
    if (!dbg.isAttached()) {
      dbg.attach()
      await this.setupAutoAttach(dbg)
      throwIfCancelled()
    }
    return withTimeout(dbg.sendCommand(method, params ?? {}, sessionId), method, timeoutMs, signal)
  }

  async evalJs(script: string, sessionId?: string): Promise<unknown> {
    const res = (await this.sendCdp(
      "Runtime.evaluate",
      {
        expression: evalJsExpression(script),
        returnByValue: true,
        awaitPromise: true,
      },
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
    await this.runInput(() => interactions.click(this.interactCtx(), selector, button))
  }

  async elementHref(selector: string): Promise<string> {
    return interactions.elementHref(this.interactCtx(), selector)
  }

  async dblclick(selector: string): Promise<void> {
    await this.runInput(() => interactions.dblclick(this.interactCtx(), selector))
  }

  async hover(selector: string): Promise<void> {
    await this.runInput(() => interactions.hover(this.interactCtx(), selector))
  }

  async fill(selector: string, text: string): Promise<void> {
    await this.runInput(() => interactions.fill(this.interactCtx(), selector, text))
  }

  async type(
    selector: string,
    text: string,
    clear = false,
    delayMs = 0,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.runInput(() =>
      interactions.type(this.interactCtx(), selector, text, clear, delayMs, signal)
    )
  }

  async press(key: string): Promise<void> {
    await this.runInput(() => interactions.press(this.interactCtx(), key, this.keyboardModifiers))
  }

  async focus(selector: string): Promise<void> {
    await this.runInput(() => interactions.focus(this.interactCtx(), selector))
  }

  async check(selector: string): Promise<void> {
    await this.runInput(() => interactions.check(this.interactCtx(), selector))
  }

  async uncheck(selector: string): Promise<void> {
    await this.runInput(() => interactions.uncheck(this.interactCtx(), selector))
  }

  async select(selector: string, values: string[]): Promise<void> {
    await this.runInput(() => interactions.select(this.interactCtx(), selector, values))
  }

  async scroll(
    selector?: string,
    direction: "up" | "down" | "left" | "right" = "down",
    amount = 300,
  ): Promise<void> {
    await this.runInput(() =>
      interactions.scroll(this.interactCtx(), selector, direction, amount)
    )
  }

  async scrollIntoView(selector: string): Promise<void> {
    await this.runInput(() => interactions.scrollIntoView(this.interactCtx(), selector))
  }

  async drag(source: string, target: string): Promise<void> {
    await this.runInput(() => interactions.drag(this.interactCtx(), source, target))
  }

  async highlight(selector: string): Promise<void> {
    await interactions.highlight(this.interactCtx(), selector)
  }

  async upload(selector: string, files: string[]): Promise<void> {
    await this.runInput(() => interactions.upload(this.interactCtx(), selector, files))
  }

  async download(
    selector: string,
    path: string,
    timeoutMs = 1_800_000,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted) throw new Error("download was cancelled")
    if (this.downloadActive) throw new Error("a download is already in progress for this tab")
    this.downloadActive = true
    const wc = this.view.webContents
    return new Promise<string>((resolve, reject) => {
      let started = false
      let settled = false
      let item: DownloadItem | null = null
      let cancellationError: Error | null = null
      let timer!: ReturnType<typeof setTimeout>
      const cleanup = (): void => {
        clearTimeout(timer)
        wc.session.off("will-download", onWillDownload)
        signal?.removeEventListener("abort", onAbort)
        this.cancelDownloads.delete(cancel)
        this.downloadActive = false
      }
      const fail = (error: Error): void => {
        if (!settled) {
          settled = true
          reject(error)
        }
        cleanup()
      }
      const cancelItem = (activeItem: DownloadItem, error: Error): void => {
        try {
          activeItem.cancel()
        } catch (cancelError) {
          fail(
            new Error(
              `${error.message}; failed to cancel download: ${
                cancelError instanceof Error ? cancelError.message : String(cancelError)
              }`,
            ),
          )
        }
      }
      const cancel = (error: Error): void => {
        if (cancellationError) return
        if (!item && error.message === "tab was closed during download") {
          fail(error)
          return
        }
        cancellationError = error
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        timer = setTimeout(() => {
          if (item) {
            fail(
              new Error(
                `${error.message}; download cancellation was not confirmed within ${waits.formatTimeout(DOWNLOAD_CANCEL_CONFIRM_TIMEOUT)}`,
              ),
            )
          } else {
            cleanup()
          }
        }, DOWNLOAD_CANCEL_CONFIRM_TIMEOUT)
        if (item) {
          cancelItem(item, error)
        } else {
          settled = true
          reject(error)
        }
      }
      const onAbort = (): void => cancel(new Error("download was cancelled"))
      const succeed = (value: string): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const onWillDownload = (_event: unknown, downloadItem: DownloadItem, contents: WebContents): void => {
        if (contents !== wc) return
        started = true
        item = downloadItem
        wc.session.off("will-download", onWillDownload)
        downloadItem.setSavePath(normalize(path))
        downloadItem.once("done", (_doneEvent, state) => {
          if (cancellationError) fail(cancellationError)
          else if (state === "completed") succeed(downloadItem.getSavePath())
          else fail(new Error(`download failed: ${state}`))
        })
        if (cancellationError) cancelItem(downloadItem, cancellationError)
      }
      timer = setTimeout(() => {
        cancel(
          new Error(
            started
              ? `download did not finish within ${waits.formatTimeout(timeoutMs)}`
              : `download did not start within ${waits.formatTimeout(timeoutMs)}`,
          ),
        )
      }, timeoutMs)
      this.cancelDownloads.add(cancel)
      wc.session.on("will-download", onWillDownload)
      signal?.addEventListener("abort", onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      this.runInput(() => interactions.click(this.interactCtx(), selector)).catch((error) => {
        fail(error instanceof Error ? error : new Error(String(error)))
      })
    })
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
    await this.runInput(async () => {
      const { modifiers, info } = parseKeyChord(key)
      const modifier = modifierBitForKey(info.key)
      const nextModifiers = this.keyboardModifiers | modifiers | modifier
      await input.keyDown(this.cdpSend, info, nextModifiers)
      if (modifier) this.keyboardModifiers = nextModifiers
    })
  }

  async keyUp(key: string): Promise<void> {
    await this.runInput(async () => {
      const { modifiers, info } = parseKeyChord(key)
      const modifier = modifierBitForKey(info.key)
      const nextModifiers = modifier
        ? this.keyboardModifiers & ~modifier
        : this.keyboardModifiers | modifiers
      await input.keyUp(this.cdpSend, info, nextModifiers)
      if (modifier) this.keyboardModifiers = nextModifiers
    })
  }

  async keyboardType(text: string): Promise<void> {
    await this.runInput(() => input.typeText(this.cdpSend, text, this.keyboardModifiers))
  }

  async keyboardInsertText(text: string): Promise<void> {
    await this.runInput(() => input.insertText(this.cdpSend, text))
  }

  async mouseMove(x: number, y: number): Promise<void> {
    await this.runInput(() => input.mouseMove(this.cdpSend, this.mouseState, x, y))
  }

  async mouseDown(button: MouseButton = "left"): Promise<void> {
    await this.runInput(() => input.mouseDown(this.cdpSend, this.mouseState, button))
  }

  async mouseUp(button: MouseButton = "left"): Promise<void> {
    await this.runInput(() => input.mouseUp(this.cdpSend, this.mouseState, button))
  }

  async mouseWheel(deltaX: number, deltaY: number): Promise<void> {
    await this.runInput(() => input.mouseWheel(this.cdpSend, this.mouseState, deltaX, deltaY))
  }

  private runInput(operation: () => Promise<void>): Promise<void> {
    const task = this.inputTask.then(() => {
      if (this.destroyed || this.view.webContents.isDestroyed()) {
        throw new Error("tab was closed before input")
      }
      return operation()
    })
    this.inputTask = task.catch(() => {})
    return task
  }

  async waitForSelector(
    selector: string,
    state?: WaitState,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<void> {
    await waits.waitForSelector(this.cdpSend, selector, state, timeoutMs, signal)
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
    if (wc.isDestroyed()) throw new Error("tab was closed while waiting for load")
    if (!wc.isLoading()) return
    await new Promise<void>((resolve, reject) => {
      const removeListener = (): void => {
        if (state === "domcontentloaded") wc.off("dom-ready", onLoaded)
        else wc.off("did-finish-load", onLoaded)
        wc.off("destroyed", onDestroyed)
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        removeListener()
      }
      const onLoaded = (): void => {
        cleanup()
        resolve()
      }
      const onDestroyed = (): void => {
        cleanup()
        reject(new Error("tab was closed while waiting for load"))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`wait_for_load ${state} timed out after ${waits.formatTimeout(timeoutMs)}`))
      }, timeoutMs)
      if (state === "domcontentloaded") wc.on("dom-ready", onLoaded)
      else wc.on("did-finish-load", onLoaded)
      wc.once("destroyed", onDestroyed)
    })
  }

  async screenshot(opts: ScreenshotOptions): Promise<ScreenshotResult> {
    if (!opts.selector && !opts.fullPage) {
      try {
        const image = await this.view.webContents.capturePage()
        const format = opts.format ?? "png"
        const buffer = format === "jpeg" ? image.toJPEG(opts.quality ?? 80) : image.toPNG()
        return {
          data: buffer.toString("base64"),
          mimeType: format === "jpeg" ? "image/jpeg" : "image/png"
        }
      } catch (error) {
        if (!(error instanceof Error) || !/display surface/i.test(error.message)) throw error
      }
    }
    return screenshot(this.interactCtx(), opts)
  }

  async pdf(): Promise<Buffer> {
    return this.view.webContents.printToPDF({ printBackground: true })
  }

  async read(): Promise<{ url: string; title?: string; content: string }> {
    const readDocumentHtml = async (): Promise<string | undefined> => {
      const res = (await this.sendCdp("Runtime.evaluate", {
        expression: "document.documentElement?.outerHTML ?? null",
        returnByValue: true,
      })) as {
        result?: { value?: unknown }
        exceptionDetails?: { exception?: { description?: string }; text?: string }
      }
      if (res.exceptionDetails) {
        throw new Error(
          res.exceptionDetails.exception?.description ??
            res.exceptionDetails.text ??
            "page read evaluation failed",
        )
      }
      return typeof res.result?.value === "string" ? res.result.value : undefined
    }

    let html = await readDocumentHtml()
    if (html === undefined) {
      await waits.waitForFunction(this.cdpSend, "document.documentElement", 5000)
      html = await readDocumentHtml()
    }
    if (html === undefined) throw new Error("page DOM is unavailable after waiting for it to load")

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
      const navigationUrl = normalizeUrl(details.url) ?? details.url
      if (navigationUrl) this.activeNavigationUrls.add(navigationUrl)
      this.error = null
      this.resetPageState()
      if (!sameOrigin(details.url, this.currentUrl)) {
        this.favIconUrl = ""
        this.favIconRequest++
      }
      emit()
    })
    wc.on("did-navigate", syncUrl)
    wc.on("did-navigate-in-page", syncUrl)
    wc.on("page-title-updated", emit)
    wc.on("page-favicon-updated", (_event, favicons) => {
      void this.setFavIcon(favicons).catch(() => {})
      emit()
    })
    wc.on("did-start-loading", emit)
    wc.on("did-stop-loading", emit)
    wc.on("did-fail-load", (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      const normalizedFailedUrl = normalizeUrl(failedUrl) ?? failedUrl
      if (
        this.activeNavigationUrls.size > 0 &&
        !this.activeNavigationUrls.has(normalizedFailedUrl)
      ) return
      this.pendingUrl = ""
      this.error = { code: errorCode, description: errorDescription }
      emit()
    })
    wc.on("render-process-gone", (_event, details) => {
      this.error = { code: -1, description: `render process gone: ${details.reason}` }
      this.resetInputState()
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
          if (this.handleNetworkEvent(eventMethod, eventParams, eventSessionId || undefined)) return
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
      await dbg.sendCommand("Network.enable").catch(() => {})
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
        dbg.sendCommand("Network.enable", {}, sid).catch(() => {})
      }
      return true
    }
    if (method === "Target.detachedFromTarget") {
      const sessionId = (params as { sessionId?: string } | null)?.sessionId
      if (sessionId) {
        const prefix = `${sessionId}\0`
        let changed = false
        for (const key of this.pendingNetworkRequests) {
          if (!key.startsWith(prefix)) continue
          this.pendingNetworkRequests.delete(key)
          changed = true
        }
        if (changed) {
          for (const waiter of this.networkWaiters) waiter()
        }
      }
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
      waitForEvent: (method, sessionId, timeoutMs) =>
        this.waitForCdpEvent(method, sessionId, timeoutMs),
      refMap: this.refMap,
      sessions: this.frames.asMap(),
    }
  }

  private waitForCdpEvent(
    method: string,
    sessionId?: string,
    timeoutMs = 5000,
  ): Promise<unknown> {
    const dbg = this.view.webContents.debugger
    const wc = this.view.webContents
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        dbg.off("message", onMessage)
        wc.off("destroyed", onDestroyed)
      }
      const onMessage = (
        _event: Electron.Event,
        eventMethod: string,
        params: unknown,
        eventSessionId?: string,
      ): void => {
        if (eventMethod !== method || (sessionId ?? "") !== (eventSessionId ?? "")) return
        cleanup()
        resolve(params)
      }
      const onDestroyed = (): void => {
        cleanup()
        reject(new Error(`Tab closed while waiting for CDP event: ${method}`))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`CDP event timed out: ${method}`))
      }, timeoutMs)
      dbg.on("message", onMessage)
      wc.once("destroyed", onDestroyed)
    })
  }

  private assertNavigationCurrent(generation: number, target?: string): void {
    if (generation !== this.navigationGeneration) {
      throw new Error(`navigation was superseded${target ? `: ${target}` : ""}`)
    }
  }

  private async waitForNetworkIdle(timeoutMs: number): Promise<void> {
    await this.cdpReady
    const wc = this.view.webContents
    if (wc.isDestroyed()) throw new Error("tab was closed while waiting for load")
    return new Promise<void>((resolve, reject) => {
      let idle: ReturnType<typeof setTimeout> | null = null
      let settled = false
      const cleanup = (): void => {
        clearTimeout(deadline)
        if (idle) clearTimeout(idle)
        this.networkWaiters.delete(check)
        wc.off("destroyed", onDestroyed)
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
      const check = (): void => {
        if (this.pendingNetworkRequests.size === 0) {
          arm()
        } else if (idle) {
          clearTimeout(idle)
          idle = null
        }
      }
      const onDestroyed = (): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error("tab was closed while waiting for load"))
      }
      const deadline = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(`wait_for_load networkidle timed out after ${waits.formatTimeout(timeoutMs)}`))
      }, timeoutMs)
      this.networkWaiters.add(check)
      wc.once("destroyed", onDestroyed)
      check()
    })
  }

  private handleNetworkEvent(method: string, params: unknown, sessionId?: string): boolean {
    if (!method.startsWith("Network.")) return false
    if (
      method !== "Network.requestWillBeSent" &&
      method !== "Network.loadingFinished" &&
      method !== "Network.loadingFailed"
    ) return true
    const requestId = (params as { requestId?: string } | null)?.requestId
    if (!requestId) return true
    const key = `${sessionId ?? ""}\0${requestId}`
    if (method === "Network.requestWillBeSent") {
      this.pendingNetworkRequests.add(key)
    } else if (!this.pendingNetworkRequests.delete(key)) {
      const suffix = `\0${requestId}`
      const matches = [...this.pendingNetworkRequests].filter((candidate) =>
        candidate.endsWith(suffix),
      )
      if (matches.length === 1) this.pendingNetworkRequests.delete(matches[0])
    }
    for (const waiter of this.networkWaiters) waiter()
    return true
  }

  private resetPageState(): void {
    this.refMap.clear()
    this.nextRef = 1
    this.frames.clear()
    this.pendingNetworkRequests.clear()
    for (const waiter of this.networkWaiters) waiter()
  }

  private resetInputState(): void {
    this.keyboardModifiers = 0
    this.mouseState.x = 0
    this.mouseState.y = 0
    this.mouseState.buttons = 0
  }

  private async setFavIcon(favicons: string[]): Promise<void> {
    const wc = this.view.webContents
    const pageUrl = wc.getURL()
    const sourceUrl = favicons.at(-1) ?? ""
    const request = ++this.favIconRequest
    if (!sourceUrl) return

    const dataUrl = await faviconDataUrl(sourceUrl)
    if (request !== this.favIconRequest || wc.isDestroyed() || wc.getURL() !== pageUrl) return
    if (dataUrl) {
      this.favIconUrl = dataUrl
      this.onChange?.()
      return
    }

    const fallbackUrl = faviconOriginFallback(pageUrl)
    if (!fallbackUrl || fallbackUrl === sourceUrl) return
    const fallbackDataUrl = await faviconDataUrl(fallbackUrl)
    if (
      request !== this.favIconRequest ||
      wc.isDestroyed() ||
      wc.getURL() !== pageUrl ||
      !fallbackDataUrl
    ) return
    this.favIconUrl = fallbackDataUrl
    this.onChange?.()
  }
}
