// Live probe for "browser_navigate 总是超时" — where does the 60s navigation timeout actually come from?
//
// `waitForWebContentsLoad` waits on TWO phases, each with its OWN 60s deadline:
//   phase A (load event): any of did-finish-load / did-stop-loading / did-navigate(accepted URL)
//                         → else `navigation load event timed out after 60s`
//   phase B (not-loading):  wc.isLoading() must be false, stable for 100ms
//                         → else `navigation loading state timed out after 60s`
//
// The probe records the exact event timeline for a real navigation and reports which phase
// (if any) stalls. We instrument a local fixture that mimics the SPA + redirect + late-resource
// shapes seen on xiaohongshu, plus (optionally) a real site when SITE=1.
import { app, BrowserWindow } from "electron"
import { createServer, type Server } from "node:http"
import { BrowserTab } from "../../../../src/extensions/browser/main/tab"

const SITE = process.env.SITE ?? ""
const ROUNDS = Number(process.env.ROUNDS ?? "3")

interface Timeline { t: number; event: string; detail?: string }

function instrument(tab: BrowserTab, timeline: Timeline[]) {
  const t0 = Date.now()
  const wc = tab.webContents
  const rec = (event: string, detail?: string) => timeline.push({ t: Date.now() - t0, event, detail })
  wc.on("did-start-loading", () => rec("did-start-loading"))
  wc.on("did-stop-loading", () => rec("did-stop-loading"))
  wc.on("did-finish-load", () => rec("did-finish-load"))
  wc.on("did-fail-load", (_e, code, desc, url, main) => rec("did-fail-load", `${code} ${desc} main=${main} ${url}`))
  wc.on("did-start-navigation", (d) => rec("did-start-navigation", `${d.isMainFrame ? "main" : "sub"} sameDoc=${d.isSameDocument} ${d.url.slice(0, 90)}`))
  wc.on("did-navigate", (_e, url) => rec("did-navigate", url.slice(0, 90)))
  wc.on("did-navigate-in-page", (_e, url) => rec("did-navigate-in-page", url.slice(0, 90)))
  const poll = setInterval(() => rec("tick", `isLoading=${wc.isLoading()}`), 1000)
  return () => clearInterval(poll)
}

function listen(handler: (url: string, res: import("node:http").ServerResponse) => void): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => handler(req.url ?? "/", res))
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

async function run(): Promise<void> {
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 900, height: 700 })
  const timeline: Timeline[] = []

  // Fixture shapes that reproduce the three suspected mechanisms:
  //  /redirect  : 302 → different path (SPA trailing-slash style)
  //  /slow-res  : initial HTML finishes fast, but a subresource never finishes (isLoading stays true)
  //  /spa       : history.pushState right after load (same-document navigation)
  const server = await listen((url, res) => {
    if (url.startsWith("/redirect")) {
      res.writeHead(302, { location: "/redirected/" })
      return res.end()
    }
    if (url.startsWith("/redirected")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      return res.end(`<!doctype html><title>redirected</title><body>redirected ok</body>`)
    }
    if (url.startsWith("/slow-res")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      return res.end(
        `<!doctype html><title>slow-res</title><body>slow<iframe src="/never-finishes"></iframe></body>`
      )
    }
    if (url.startsWith("/never-finishes")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.write("<!doctype html><title>nf</title><body>hanging")
      // never end()
      return
    }
    if (url.startsWith("/spa")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      return res.end(
        `<!doctype html><title>spa</title><body>spa<script>setTimeout(()=>history.pushState({},'','/spa-view'),200)</script></body>`
      )
    }
    res.writeHead(404).end()
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind")
  const base = `http://127.0.0.1:${address.port}`

  const cases: Array<{ label: string; url: string }> = SITE
    ? Array.from({ length: ROUNDS }, (_, i) => ({ label: `site-round-${i + 1}`, url: SITE }))
    : [
        { label: "redirect", url: `${base}/redirect?keyword=x` },
        { label: "slow-res", url: `${base}/slow-res` },
        { label: "spa", url: `${base}/spa` },
      ]

  let passed = true
  try {
    for (const c of cases) {
      timeline.length = 0
      const tab = new BrowserTab(1, `nav-timeout-${c.label}-${Date.now()}`, { automation: false })
      const stop = instrument(tab, timeline)
      const started = Date.now()
      let outcome: string
      try {
        await tab.navigateAndWait(c.url)
        outcome = `OK ${Date.now() - started}ms`
      } catch (error) {
        outcome = `THREW ${Date.now() - started}ms: ${error instanceof Error ? error.message : String(error)}`
      }
      stop()
      const url = (() => { try { return tab.webContents.getURL() } catch { return "<gone>" } })()
      console.log(`\n=== CASE ${c.label} → ${outcome}`)
      console.log(`    final url: ${url}`)
      // print only meaningful events (drop per-second ticks unless they flip isLoading)
      let lastTick: string | undefined
      for (const e of timeline) {
        if (e.event === "tick") {
          if (e.detail === lastTick) continue
          lastTick = e.detail
        }
        console.log(`    +${String(e.t).padStart(6)}ms  ${e.event}${e.detail ? "  " + e.detail : ""}`)
      }
      const finished = timeline.some((e) => e.event === "did-finish-load")
      const stopped = timeline.some((e) => e.event === "did-stop-loading")
      if (!outcome.startsWith("OK")) {
        console.log(`    !! TIMEOUT. did-finish-load=${finished} did-stop-loading=${stopped}`)
        passed = false
      }
      tab.destroy()
    }
    console.log(passed ? "\nPASS nav-timeout probe (no timeouts)" : "\nFAIL nav-timeout probe (reproduced a timeout)")
  } finally {
    server.close()
    window.destroy()
    app.exit(passed ? 0 : 1)
  }
}

void run().catch((error) => {
  console.error(error)
  app.exit(1)
})
