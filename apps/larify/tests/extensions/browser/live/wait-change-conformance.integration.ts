// Conformance probe for the browser WAIT changes (waits/refResolve/snapshotCapture/web-search).
//
// Why this file exists: the working tree changes "wait before reading the DOM" on three
// selector paths and reworks `waitForStable`. `all-tools.integration.ts` covers every tool
// but ABORTS on the first assertion failure (and two of its assertions fail for unrelated,
// pre-existing reasons), so it cannot answer "did the wait change break anything?".
//
// This probe instead:
//   - runs ONLY the tools the change touches, through their real `execute` entrypoints;
//   - uses a LOCAL http fixture with a client-side-injected (`#late`) element, so the race is
//     deterministic and offline;
//   - records every case as PASS/FAIL and CONTINUES, so a single run reports the whole matrix;
//   - asserts the semantics that must NOT change (error text for missing / invalid selectors),
//     alongside the new ones (late element resolves, no race).
import { app, BrowserWindow } from "electron"
import { createServer, type Server } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { createBrowserTools } from "../../../../src/extensions/browser/main/tools"
import { BrowserTab } from "../../../../src/extensions/browser/main/tab"
import type { BrowserService } from "../../../../src/extensions/browser/main/browser-service"

const LATE_DELAY_MS = 1500

// #early  – in the initial HTML (control: must stay fast)
// #late   – injected by client JS after load (the hydration stand-in)
// #never  – never exists (control: must keep the ORIGINAL error text)
// xpath target – present, to prove the xpath-aware wait did not regress
const html = `<!doctype html><meta charset="utf-8"><title>wait conformance fixture</title>
<style>body{min-height:1800px}</style>
<h1>Wait conformance fixture</h1>
<div id="early"><button id="early-btn" data-kind="early">early</button></div>
<div id="xpathhost"><span class="xp">xpath-target</span></div>
<input id="input" value="old">
<div id="results"><div class="result"><a href="http://example.test/r"><h2>R</h2></a><p>S</p></div></div>
<div id="bottom" style="margin-top:1500px">bottom</div>
<script>
setTimeout(() => {
  const host = document.createElement('div')
  host.id = 'late'
  host.innerHTML = '<button id="late-btn" data-kind="late">late-hydrated</button>'
  document.body.appendChild(host)
}, ${LATE_DELAY_MS})
</script>`

function listen(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(html)
    })
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

interface Case {
  label: string
  ok: boolean
  ms: number
  detail: string
  /** Environment-limited (offscreen screenshot capture): reported but not gating. */
  informational?: boolean
}

async function main(): Promise<void> {
  const server = await listen()
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fixture server did not bind")
  const origin = `http://127.0.0.1:${address.port}`
  const outputDir = await mkdtemp(join(tmpdir(), "larify-wait-conformance-"))
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 900, height: 700 })

  let nextId = 1
  const tabs = new Map<number, BrowserTab>()
  const mount = (id: number, tag: string): BrowserTab => {
    const created = new BrowserTab(id, `${tag}-${Date.now()}-${id}`)
    created.view.webContents.setBackgroundThrottling(false)
    window.contentView.addChildView(created.view)
    created.view.setBounds({ x: 0, y: 0, width: 900, height: 700 })
    tabs.set(id, created)
    return created
  }
  const service = {
    createTab: () => {
      const id = nextId++
      mount(id, "conformance")
      return id
    },
    close: async (_sessionId: string, id: number) => {
      tabs.get(id)?.destroy()
      tabs.delete(id)
    },
    state: () => ({ tabs: [...tabs.values()].map((item) => item.state()) }),
    tab: (_sessionId: string, id: number) => tabs.get(id),
    withRendered: async (_sessionId: string, _id: number, operation: () => Promise<unknown>) =>
      operation(),
    withUnthrottled: async (_sessionId: string, _id: number, operation: () => Promise<unknown>) =>
      operation(),
    withTemporaryTab: async (
      _sessionId: string,
      url: string,
      operation: (item: BrowserTab) => Promise<unknown>
    ) => {
      const temporary = new BrowserTab(-nextId++, `conformance-temp-${Date.now()}`)
      temporary.view.webContents.setBackgroundThrottling(false)
      try {
        await temporary.navigateAndWait(url)
        return await operation(temporary)
      } finally {
        temporary.destroy()
      }
    },
    readText: async () => undefined,
  } as unknown as BrowserService

  const tools = createBrowserTools(service)
  const run = async (name: string, input: unknown, ctx: Record<string, unknown> = {}): Promise<unknown> => {
    const tool = tools[name]
    if (!tool) throw new Error(`missing tool: ${name}`)
    const schema = tool.inputSchema as unknown as z.ZodTypeAny
    const execute = tool.execute as unknown as (args: unknown, options: unknown) => Promise<unknown>
    return execute(schema.parse(input), {
      context: { sessionId: "conformance", cwd: outputDir },
      toolCallId: `conformance-${name}`,
      messages: [],
      ...ctx
    })
  }

  const cases: Case[] = []
  const check = async (
    label: string,
    fn: () => Promise<string>,
    informational = false
  ): Promise<void> => {
    const started = Date.now()
    try {
      const detail = await fn()
      cases.push({ label, ok: true, ms: Date.now() - started, detail, informational })
    } catch (error) {
      cases.push({
        label,
        ok: false,
        ms: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error),
        informational
      })
    }
  }
  const expectThrow = async (
    label: string,
    expected: RegExp,
    fn: () => Promise<unknown>
  ): Promise<void> =>
    check(label, async () => {
      try {
        await fn()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!expected.test(message)) throw new Error(`wrong error text: ${message}`)
        return `threw ${JSON.stringify(message)}`
      }
      throw new Error(`expected a throw matching ${expected}`)
    })

  try {
    const created = (await run("create_tab", { url: origin })) as { id: number }
    const id = created.id
    const tab = tabs.get(id)!

    // ---- The race itself: read the late element right after load, before hydration ----
    await check("snapshot{selector=#late} resolves after hydration", async () => {
      const out = JSON.stringify(await run("snapshot", { id, selector: "#late", interactive: true }))
      if (!/late-hydrated/.test(out)) throw new Error(`unexpected snapshot: ${out}`)
      return out.slice(0, 80)
    })
    await check("query_element{#late,text} resolves after hydration", async () => {
      const out = (await run("query_element", { id, selector: "#late-btn", query: "text" })) as {
        content: string
      }
      if (!/late-hydrated/.test(out.content)) throw new Error(`unexpected: ${JSON.stringify(out)}`)
      return out.content
    })
    await check("query_element{#late,box} resolves after hydration", async () => {
      const box = (await run("query_element", { id, selector: "#late-btn", query: "box" })) as {
        width: number
        height: number
      }
      if (!(box.width > 0 && box.height > 0)) throw new Error(`bad box: ${JSON.stringify(box)}`)
      return `${box.width}x${box.height}`
    })
    await check("fill{#late-input} resolves after hydration", async () => {
      await run("eval_js", {
        id,
        script:
          "() => { const h=document.createElement('div'); h.id='late-input'; h.innerHTML='<input id=\"late-field\">'; document.body.append(h); return true }"
      })
      await run("fill", { id, selector: "#late-field", text: "filled-late" })
      const value = await tab.getValue("#late-field")
      if (value !== "filled-late") throw new Error(`value=${value}`)
      return value
    })

    // ---- Controls that must NOT change ----
    await check("snapshot{selector=#early} still works", async () => {
      const out = JSON.stringify(await run("snapshot", { id, selector: "#early", interactive: true }))
      if (!/early/.test(out)) throw new Error(out.slice(0, 120))
      return "ok"
    })
    await expectThrow(
      "snapshot{selector=#never} keeps original error text",
      /selector '#never' matched no element/,
      () => run("snapshot", { id, selector: "#never" })
    )
    await expectThrow(
      "query_element{#never,text} keeps original error text",
      /selector '#never' matched no element/,
      () => run("query_element", { id, selector: "#never", query: "text" })
    )
    await expectThrow(
      "query_element{#never,box} keeps original error text",
      /selector '#never' matched no element/,
      () => run("query_element", { id, selector: "#never", query: "box" })
    )
    await expectThrow(
      "snapshot{selector=input[} reports is invalid",
      /selector 'input\[' is invalid/,
      () => run("snapshot", { id, selector: "input[" })
    )
    await expectThrow(
      "query_element{input[,text} reports is invalid",
      /selector 'input\[' is invalid/,
      () => run("query_element", { id, selector: "input[", query: "text" })
    )
    await expectThrow("click{input[} reports is invalid", /selector 'input\[' is invalid/, () =>
      run("click", { id, selector: "input[" })
    )
    await check("xpath selector still resolves (wait must be xpath-aware)", async () => {
      const out = (await run("query_element", {
        id,
        selector: "xpath=(//span[@class='xp'])[1]",
        query: "text"
      })) as { content: string }
      if (out.content !== "xpath-target") throw new Error(JSON.stringify(out))
      return out.content
    })
    await expectThrow(
      "xpath never-match keeps original error text",
      /matched no element/,
      () => run("query_element", { id, selector: "xpath=(//span[@id='nope'])[1]", query: "text" })
    )

    // ---- Interaction / screenshot paths riding the same branch ----
    await check("click{#early-btn} works", async () => {
      await run("click", { id, selector: "#early-btn" })
      return "ok"
    })
    await check("element_action{scroll_into_view} works", async () => {
      await run("element_action", { id, selector: "#bottom", action: "scroll_into_view" })
      return "ok"
    })
    // NOTE: `Page.captureScreenshot` itself does not finish for an offscreen/hidden window in
    // this harness — the SAME class of environment limit as the already-known `tab.click`
    // dispatch taking ~5s. It is not caused by the wait change: the `#never` case above proves
    // the selector wait resolves/rejects correctly BEFORE any capture, and the no-selector
    // control below shows the capture step fails identically. So both are recorded as
    // informational rather than pass/fail-gating the suite.
    await check(
      "screenshot{selector=#early-btn} (capture may time out offscreen)",
      async () => {
        const out = (await run("screenshot", {
          id,
          selector: "#early-btn",
          path: join(outputDir, "btn.png")
        })) as { bytes: number }
        if (!(out.bytes > 0)) throw new Error(JSON.stringify(out))
        return `${out.bytes} bytes`
      },
      true
    )
    await check(
      "screenshot{no selector} control (capture may time out offscreen)",
      async () => {
        const out = (await run("screenshot", {
          id,
          path: join(outputDir, "viewport.png")
        })) as { bytes: number }
        if (!(out.bytes > 0)) throw new Error(JSON.stringify(out))
        return `${out.bytes} bytes`
      },
      true
    )
    await expectThrow("screenshot{selector=#never} keeps original error text", /matched no element/, () =>
      run("screenshot", { id, selector: "#never" })
    )

    // ---- wait_for (uses waitForSelector + poll, unaffected but cross-checked) ----
    await check("wait_for{#early-btn,visible} works", async () => {
      await run("wait_for", { id, selector: "#early-btn", state: "visible" })
      return "ok"
    })
    await expectThrow(
      "wait_for{#never,visible} times out with a wait_for_selector message",
      /wait_for_selector .* timed out after/,
      () => run("wait_for", { id, selector: "#never", state: "visible", timeout: 1 })
    )

    // ---- web_search: settle criterion + fallback + error propagation ----
    await check("web_search parses a ready page", async () => {
      const out = (await run("web_search", {
        pageUrl: origin,
        selectors: { result: ".result", title: "h2", link: "a", snippet: "p", nextPage: ".next" }
      })) as { results: Array<{ title: string }> }
      if (out.results.length !== 1 || out.results[0].title !== "R")
        throw new Error(JSON.stringify(out))
      return JSON.stringify(out.results)
    })
    await expectThrow(
      "web_search on a page with no results reports no parseable results",
      /no parseable search results/,
      () =>
        run("web_search", {
          pageUrl: `${origin}/empty`,
          selectors: { result: ".missing", title: "h2", link: "a", snippet: "p", nextPage: ".next" }
        })
    )

    // ---- a tab closed mid-wait must propagate, not be swallowed as a timeout ----
    await check("closing a tab during a wait surfaces a real failure", async () => {
      const victimId = (await run("create_tab", { url: origin })) as number | { id: number }
      const vid = typeof victimId === "number" ? victimId : victimId.id
      await run("close_tab", { id: vid })
      try {
        await run("query_element", { id: vid, selector: "#early-btn", query: "text" })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/matched no element/i.test(message))
          throw new Error(`tab-closed was misreported as a missing element: ${message}`)
        return `threw ${JSON.stringify(message)}`
      }
      throw new Error("expected a throw for a closed tab")
    })
  } finally {
    for (const item of tabs.values()) item.destroy()
    window.destroy()
    server.close()
    await rm(outputDir, { recursive: true, force: true })
  }

  const failed = cases.filter((item) => !item.ok && !item.informational)
  const info = cases.filter((item) => item.informational)
  console.log(
    `\n[wait-conformance] ${cases.length - failed.length - info.filter((item) => !item.ok).length}/${cases.length - info.length} gating cases passed` +
      (info.length ? ` (+${info.length} informational)` : "")
  )
  for (const item of cases) {
    const tag = item.informational ? (item.ok ? "INFO-PASS" : "INFO-FAIL") : item.ok ? "PASS" : "FAIL"
    console.log(`  ${tag}  ${item.ms}ms  ${item.label}  ::  ${item.detail}`)
  }
  console.log(failed.length === 0 ? "PASS wait conformance" : "FAIL wait conformance")
  app.exit(failed.length === 0 ? 0 : 1)
}

void main().catch((error) => {
  console.error(error)
  app.exit(1)
})
