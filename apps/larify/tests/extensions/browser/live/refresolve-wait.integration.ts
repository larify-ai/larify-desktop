// Live end-to-end check for the refResolve `{selector}` race fix.
//
// Question: on a page whose target element is injected by client-side JS AFTER load, do the user
// selector paths resolve it (thanks to the new wait-before-read in `refResolve`), while keeping the
// original `matched no element` failure text for elements that never exist?
//
//   - `tab.getText('#late-btn')`  → `resolveRefToObjectId` `{selector}` branch
//   - `tab.getBox('#late-btn')`   → `resolveRefToBox`      `{selector}` branch
//   - `tab.click('#late-btn')`    → `resolveRefToBox` + real mouse dispatch
//
// Fixture is a local http page so the probe is deterministic:
//   #early  – present in the initial HTML
//   #late   – injected by setTimeout(1500ms) after load  (hydration stand-in)
//   #never  – never appears
// Expectation: #late SUCCESS after ~1.5s (was THREW at ms scale before the fix); #never still
// THREW with the ORIGINAL text after ~5s; #early still fast.
//
// NOTE: `tab.click` additionally pumps real mouse events through CDP on a hidden/background
// window; that dispatch alone costs ~5s in this headless harness and is unrelated to the resolve
// race, so `click` is asserted for SUCCESS only, while the resolve path is timed via getText/getBox.
import { app, BrowserWindow } from "electron"
import { createServer, type Server } from "node:http"
import { BrowserTab } from "../../../../src/extensions/browser/main/tab"

const LATE_DELAY_MS = 1500
const ROUNDS = 5

const html = `<!doctype html><meta charset="utf-8"><title>refresolve selector wait fixture</title>
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

interface ProbeCase {
  label: string
  ok: boolean
  ms: number
  text: string | null
  error: string | null
}

async function probe(tab: BrowserTab, label: string, run: () => Promise<string>): Promise<ProbeCase> {
  const started = Date.now()
  try {
    const text = await run()
    return { label, ok: true, ms: Date.now() - started, text, error: null }
  } catch (error) {
    return {
      label,
      ok: false,
      ms: Date.now() - started,
      text: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function newTab(id: number, tag: string): Promise<BrowserTab> {
  const tab = new BrowserTab(id, `${tag}-${Date.now()}`)
  tab.view.webContents.setBackgroundThrottling(false)
  return tab
}

async function run(): Promise<void> {
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 900, height: 700 })
  const server = await listen()
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fixture server did not bind")
  const url = `http://127.0.0.1:${address.port}/refresolve`
  let passed = true
  try {
    console.log(`[fixture] ${url}  late=${LATE_DELAY_MS}ms  rounds=${ROUNDS}`)

    // 1) race: query the target immediately after load, before the hydration timer fires.
    const raceTab = await newTab(-1, "refresolve-wait-race")
    try {
      await raceTab.navigateAndWait(url)
      const early = await probe(raceTab, "#early getText", async () => raceTab.getText("#early-btn"))
      const lateText = await probe(raceTab, "#late getText", async () => raceTab.getText("#late-btn"))
      const lateBox = await probe(raceTab, "#late getBox", async () =>
        JSON.stringify(await raceTab.getBox("#late-btn"))
      )
      const lateClick = await probe(raceTab, "#late click", async () => {
        await raceTab.click("#late-btn")
        return "clicked"
      })
      const neverText = await probe(raceTab, "#never getText", async () => raceTab.getText("#never"))
      const neverBox = await probe(raceTab, "#never getBox", async () =>
        JSON.stringify(await raceTab.getBox("#never"))
      )
      console.log(`  #early getText  ok=${early.ok} ${early.ms}ms ${early.error ?? early.text}`)
      console.log(`  #late  getText  ok=${lateText.ok} ${lateText.ms}ms ${lateText.error ?? lateText.text}`)
      console.log(`  #late  getBox   ok=${lateBox.ok} ${lateBox.ms}ms ${lateBox.error ?? lateBox.text}`)
      console.log(`  #late  click    ok=${lateClick.ok} ${lateClick.ms}ms ${lateClick.error ?? "SUCCESS"}`)
      console.log(`  #never getText  ok=${neverText.ok} ${neverText.ms}ms ${neverText.error ?? neverText.text}`)
      console.log(`  #never getBox   ok=${neverBox.ok} ${neverBox.ms}ms ${neverBox.error ?? neverBox.text}`)

      if (!early.ok || !/early/.test(early.text ?? "")) {
        passed = false
        console.error("  FAIL: #early regressed")
      }
      if (!lateText.ok || !/late-hydrated/.test(lateText.text ?? "")) {
        passed = false
        console.error(`  FAIL: #late getText did not resolve after waiting (${lateText.error})`)
      }
      if (!lateBox.ok) {
        passed = false
        console.error(`  FAIL: #late getBox did not resolve after waiting (${lateBox.error})`)
      }
      if (!lateClick.ok) {
        passed = false
        console.error(`  FAIL: #late click did not resolve after waiting (${lateClick.error})`)
      }
      for (const c of [neverText, neverBox]) {
        if (c.ok) {
          passed = false
          console.error(`  FAIL: ${c.label} unexpectedly resolved`)
        } else if (!/selector '#never' matched no element/.test(c.error ?? "")) {
          passed = false
          console.error(`  FAIL: ${c.label} error text changed: ${c.error}`)
        }
      }
    } finally {
      raceTab.destroy()
    }

    // 2) repeated rounds on a cold tab: the hydration race must never win on the box path.
    console.log(`[rounds] getBox('#late-btn') x${ROUNDS} on freshly loaded tabs`)
    let ok = 0
    for (let i = 1; i <= ROUNDS; i++) {
      const tab = await newTab(-100 - i, `refresolve-wait-round-${i}`)
      try {
        await tab.navigateAndWait(url)
        const result = await probe(tab, `round ${i}`, async () =>
          JSON.stringify(await tab.getBox("#late-btn"))
        )
        if (result.ok) {
          ok += 1
          console.log(`  round ${i}: SUCCESS ${result.ms}ms`)
        } else {
          console.error(`  round ${i}: FAILED ${result.ms}ms ${result.error}`)
        }
      } finally {
        tab.destroy()
      }
    }
    console.log(`[rounds] ${ok}/${ROUNDS}`)
    if (ok !== ROUNDS) passed = false

    console.log(passed ? "PASS refResolve selector wait fix" : "FAIL refResolve selector wait fix")
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
