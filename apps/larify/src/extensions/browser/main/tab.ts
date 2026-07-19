import { WebContentsView } from "electron"
import type { BrowserTabError, BrowserTabState } from "../shared/types"
import { faviconDataUrl, faviconOriginFallback } from "./favicon"
import { normalizeUrl } from "./url"

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return true
  }
}

export class BrowserTab {
  readonly id: number
  readonly view: WebContentsView
  private currentUrl = ""
  private favIconUrl = ""
  private favIconRequest = 0
  private error: BrowserTabError | null = null
  private onChange?: () => void

  constructor(id: number, partition: string) {
    this.id = id
    this.view = new WebContentsView({
      webPreferences: { partition, backgroundThrottling: false },
    })
    this.wireEvents()
    void this.view.webContents.loadURL("about:blank").catch(() => {})
  }

  bindChange(cb: () => void): void {
    this.onChange = cb
  }

  navigate(url: string): boolean {
    const target = normalizeUrl(url)
    if (!target) return false
    void this.view.webContents.loadURL(target).catch(() => {})
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

  state(): BrowserTabState {
    const wc = this.view.webContents
    const url = wc.getURL()
    return {
      id: this.id,
      url: url === "about:blank" ? "" : url,
      title: url === "about:blank" ? "" : wc.getTitle(),
      favIconUrl: this.favIconUrl,
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: this.error,
    }
  }

  destroy(): void {
    this.view.webContents.close()
  }

  private wireEvents(): void {
    const wc = this.view.webContents
    const emit = (): void => this.onChange?.()
    const syncUrl = (): void => {
      this.currentUrl = wc.getURL()
      emit()
    }

    wc.on("will-prevent-unload", (event) => event.preventDefault())
    wc.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      this.error = null
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
      this.error = { code: errorCode, description: errorDescription }
      emit()
    })
    wc.on("render-process-gone", (_event, details) => {
      this.error = { code: -1, description: `render process gone: ${details.reason}` }
      emit()
    })
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
