// Live end-to-end + timing diagnosis for the web_search hydration fix.
//
// Two questions:
//   (A) Correctness: cold session, repeated multi-word query -> never throws
//       "no parseable search results" and never returns a first-word degraded render.
//   (B) Cost: how much of the wall-clock comes from each stage? Compare
//       waitForNavigation alone vs. + waitForStable, on hot and cold sessions.
//
// Cold state is simulated by clearing cache+cookies on the browser session partition.
import { app, BrowserWindow, session } from "electron"
import { BrowserTab } from "../../../../src/extensions/browser/main/tab"
import {
  buildSettleExpression,
  buildParseSearchPageScript,
  executeWebSearch
} from "../../../../src/extensions/browser/main/web-search"
import { BROWSER_PARTITION } from "../../../../src/extensions/browser/shared/types"
import type { BrowserService } from "../../../../src/extensions/browser/main/browser-service"

const SELECTORS = {
  result: "#b_results > li.b_algo",
  title: "h2",
  link: "h2 a[href], a[href]:has(> h2)",
  snippet: ".b_caption p, p.b_algoSlug, p.b_lineclamp2, p.b_lineclamp3",
  nextPage: "a.sb_pagN[href]"
}

const COLD_QUERY = "可移动 拍照机器人 自动跟拍 跟随 家庭 2026 消费级"
const COLD_ROUNDS = 5
const COLD_KEYWORDS = ["机器人", "robot", "拍摄", "camera", "跟拍", "记录"]

let probes = 0

function makeService(): BrowserService {
  return {
    withTemporaryTab: async (
      _sessionId: string,
      url: string,
      callback: (tab: BrowserTab) => Promise<unknown>
    ) => {
      const tab = new BrowserTab(-++probes, `wfstable-${Date.now()}-${probes}`)
      tab.setBackgroundThrottling(false)
      try {
        await tab.navigateAndWait(url)
        return await callback(tab)
      } finally {
        tab.destroy()
      }
    }
  } as unknown as BrowserService
}

async function clearSession(): Promise<void> {
  const target = session.fromPartition(BROWSER_PARTITION)
  await target.clearCache()
  await target.clearStorageData()
}

// Stage-by-stage timing using the real primitives, mirroring executeWebSearch.
async function stageTiming(url: string): Promise<string> {
  const tab = new BrowserTab(-++probes, `wfstable-stage-${Date.now()}-${probes}`)
  tab.setBackgroundThrottling(false)
  try {
    const t0 = Date.now()
    await tab.navigateAndWait(url)
    const tNavigate = Date.now() - t0
    let tStable: number | string = "TIMEOUT"
    try {
      await tab.waitForStable(
        buildSettleExpression(SELECTORS),
        { pollMs: 100, stableTimes: 2, timeoutMs: 10_000 }
      )
      tStable = Date.now() - t0 - tNavigate
    } catch {
      // leave TIMEOUT marker
    }
    const parsed = (await tab.evalJs(buildParseSearchPageScript(SELECTORS))) as {
      results: unknown[]
    }
    return `navigate=${tNavigate}ms stable=${tStable}ms parsed=${parsed.results.length}`
  } finally {
    tab.destroy()
  }
}

// Baseline: navigation only, no settle wait, no parse. Isolates how much wall-clock the
// network/Bing side costs vs. how much our added settle wait costs.
async function navigateOnly(url: string): Promise<number> {
  const tab = new BrowserTab(-++probes, `wfstable-nav-${Date.now()}-${probes}`)
  tab.setBackgroundThrottling(false)
  try {
    const t0 = Date.now()
    await tab.navigateAndWait(url)
    return Date.now() - t0
  } finally {
    tab.destroy()
  }
}

async function runColdRound(index: number, service: BrowserService): Promise<void> {
  await clearSession()
  const started = Date.now()
  const response = await executeWebSearch(
    service,
    { query: COLD_QUERY, selectors: SELECTORS },
    { sessionId: "wfstable", cwd: process.cwd() }
  )
  const elapsed = Date.now() - started
  const titles = response.results.map((result) => result.title).join(" | ")
  const relevant = response.results.some((result) =>
    COLD_KEYWORDS.some(
      (keyword) =>
        result.title.toLowerCase().includes(keyword.toLowerCase()) ||
        (result.snippet ?? "").toLowerCase().includes(keyword.toLowerCase())
    )
  )
  if (response.results.length === 0) throw new Error(`round ${index}: returned no results`)
  if (!relevant) throw new Error(`round ${index}: results look unrelated: ${titles}`)
  const degenerate =
    response.results.length === 1 && /^(可|可移动)$/.test(response.results[0].title.trim())
  if (degenerate) throw new Error(`round ${index}: degraded first-word render: ${titles}`)
  console.log(`  cold round ${index}: ${response.results.length} results in ${elapsed}ms`)
}

async function run(): Promise<void> {
  await app.whenReady()
  const window = new BrowserWindow({ show: false })
  const url = `https://www.bing.com/search?q=${encodeURIComponent(COLD_QUERY)}`

  console.log("[timing] hot session stage breakdown (3x)")
  for (let i = 1; i <= 3; i++) console.log(`  hot ${i}: ${await stageTiming(url)}`)

  console.log("[timing] cold session stage breakdown (3x)")
  for (let i = 1; i <= 3; i++) {
    await clearSession()
    console.log(`  cold ${i}: ${await stageTiming(url)}`)
  }

  console.log("[timing] navigate-only baseline (cold, 3x) — no settle wait")
  for (let i = 1; i <= 3; i++) {
    await clearSession()
    console.log(`  cold nav-only ${i}: ${await navigateOnly(url)}ms`)
  }

  const service = makeService()
  console.log(`[cold] executeWebSearch end-to-end, query=${JSON.stringify(COLD_QUERY)} x${COLD_ROUNDS}`)
  let ok = 0
  for (let i = 1; i <= COLD_ROUNDS; i++) {
    try {
      await runColdRound(i, service)
      ok += 1
    } catch (error) {
      console.error(`  cold round ${i}: FAILED: ${(error as Error).message}`)
    }
  }
  console.log(`[cold] consistent: ${ok}/${COLD_ROUNDS}`)
  const passed = ok === COLD_ROUNDS
  console.log(passed ? "PASS web_search hydration fix" : "FAIL web_search hydration fix")
  window.destroy()
  app.exit(passed ? 0 : 1)
}

void run().catch((error) => {
  console.error(error)
  app.exit(1)
})
