// Live end-to-end check for the browser_snapshot({ selector }) race fix.
//
// Question: on a page whose target element is injected by client-side JS AFTER load,
// does `browser_snapshot({ selector })` consistently resolve it (thanks to the new
// wait-before-read in `resolveSelectorIds`), while keeping the pre-existing fast
// `matched no element` failure for elements that never exist?
//
// Fixture is a local http page so the probe is deterministic:
//   #early  – present in the initial HTML
//   #late   – injected by setTimeout(1500ms) after load  (hydration stand-in)
//   #never  – never appears
// Rounds: #late x5 must be 5/5 SUCCESS; #never must fail fast with the original text.
import { app, BrowserWindow } from "electron"
import { createServer, type Server } from "node:http"
import { BrowserTab } from "../../../../src/extensions/browser/main/tab"

const LATE_DELAY_MS = 1500
const ROUNDS = 5

const html = `<!doctype html><meta charset="utf-8"><title>snapshot selector wait fixture</title>
<div id="early"><button id="early-btn">early</button></div>
<script>
setTimeout(() => {
  const host = document.createElement('div')
  host.id = 'late'
  host.innerHTML = '<button id="late-btn">late-hydrated</button>'
  document.body.appendChild(host)
}, ${LATE_DELAY_MS})
</script>`

function listen(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(html)
    })
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

interface SnapshotCase {
  label: string
  selector: string
  ok: boolean
  ms: number
  text: string | null
  error: string | null
}

async function probe(
  tab: BrowserTab,
  label: string,
  selector: string
): Promise<SnapshotCase> {
  const started = Date.now()
  try {
    const text = await tab.snapshot({ selector, interactive: true })
    return { label, selector, ok: true, ms: Date.now() - started, text, error: null }
  } catch (error) {
    return {
      label,
      selector,
      ok: false,
      ms: Date.now() - started,
      text: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function run(): Promise<void> {
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 900, height: 700 })
  const server = await listen()
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fixture server did not bind")
  const url = `http://127.0.0.1:${address.port}/hydrated`
  let passed = true
  try {
    console.log(`[fixture] ${url}  late=${LATE_DELAY_MS}ms  rounds=${ROUNDS}`)

    // 1) race: snapshot immediately after load, before the hydration timer fires.
    const raceTab = new BrowserTab(-1, `snapshot-wait-race-${Date.now()}`)
    raceTab.view.webContents.setBackgroundThrottling(false)
    try {
      await raceTab.navigateAndWait(url)
      const early = await probe(raceTab, "early (#early)", "#early")
      const late = await probe(raceTab, "late (#late), read right after load", "#late")
      const never = await probe(raceTab, "never (#never)", "#never")
      console.log(`  #early  ok=${early.ok} ${early.ms}ms`)
      console.log(`  #late   ok=${late.ok} ${late.ms}ms ${late.error ?? "SUCCESS"}`)
      console.log(`  #never  ok=${never.ok} ${never.ms}ms ${never.error ?? "SUCCESS"}`)
      if (!early.ok) {
        passed = false
        console.error("  FAIL: #early regressed")
      }
      if (!late.ok || !/late-hydrated/.test(late.text ?? "")) {
        passed = false
        console.error("  FAIL: #late did not resolve after waiting")
      }
      if (never.ok) {
        passed = false
        console.error("  FAIL: #never unexpectedly resolved")
      } else if (!/selector '#never' matched no element/.test(never.error ?? "")) {
        passed = false
        console.error(`  FAIL: #never error text changed: ${never.error}`)
      }
    } finally {
      raceTab.destroy()
    }

    // 2) repeated rounds on a cold tab: the hydration race must never win.
    console.log(`[rounds] snapshot('#late') x${ROUNDS} on freshly loaded tabs`)
    let ok = 0
    for (let i = 1; i <= ROUNDS; i++) {
      const tab = new BrowserTab(-100 - i, `snapshot-wait-round-${Date.now()}-${i}`)
      tab.view.webContents.setBackgroundThrottling(false)
      try {
        await tab.navigateAndWait(url)
        const result = await probe(tab, `round ${i}`, "#late")
        if (result.ok && /late-hydrated/.test(result.text ?? "")) {
          ok += 1
          console.log(`  round ${i}: SUCCESS ${result.ms}ms`)
        } else {
          console.error(`  round ${i}: FAILED ${result.ms}ms ${result.error ?? "text mismatch"}`)
        }
      } finally {
        tab.destroy()
      }
    }
    console.log(`[rounds] ${ok}/${ROUNDS}`)
    if (ok !== ROUNDS) passed = false

    console.log(passed ? "PASS browser_snapshot selector wait fix" : "FAIL browser_snapshot selector wait fix")
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
