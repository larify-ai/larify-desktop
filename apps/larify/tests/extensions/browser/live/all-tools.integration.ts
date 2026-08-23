import { app, BrowserWindow } from "electron"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { createBrowserTools } from "../../../../src/extensions/browser/main/tools"
import { BrowserTab } from "../../../../src/extensions/browser/main/tab"
import { Recorder } from "../../../../src/extensions/browser/main/recorder"
import type { BrowserService } from "../../../../src/extensions/browser/main/browser-service"

const html = `<!doctype html><style>body{min-height:2400px}#drag{width:40px;height:40px;background:red}#drop{width:80px;height:80px;background:blue;margin-top:20px}#scrollbox{width:100px;height:60px;overflow:auto}#scrollcontent{width:500px;height:500px}</style>
<h1>All tools fixture</h1><input id="text" value="old"><textarea id="keys"></textarea>
<input id="check" type="checkbox"><input id="disabled" disabled><select id="select" multiple><option value="a">A</option><option value="b">B</option></select>
<button id="button" data-kind="action" style="color:rgb(255, 0, 0)">Click</button><a id="pageLink" href="/page-two">Page two</a><a id="link" href="/download">Download</a><input id="upload" type="file">
<div id="hidden" hidden>hidden</div><div id="scrollbox"><div id="scrollcontent"></div></div>
<div id="drag" draggable="true">drag</div><div id="drop">drop</div><div id="bottom" style="margin-top:1200px">bottom</div>
<script>
window.clicks=0; window.doubleClicks=0; window.contextMenus=0; window.auxClicks=0; button.onclick=()=>window.clicks++; button.ondblclick=()=>window.doubleClicks++; button.oncontextmenu=e=>{e.preventDefault();window.contextMenus++}; button.onauxclick=()=>window.auxClicks++
drag.ondragstart=e=>e.dataTransfer.setData('text/plain','ok'); drop.ondragover=e=>e.preventDefault(); drop.ondrop=e=>{e.preventDefault();window.dropped=e.dataTransfer.getData('text/plain')}
window.addEventListener('error',e=>window.lastError=e.message)
</script>`

function listen(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/download") {
        response.writeHead(200, { "content-disposition": "attachment; filename=tool.txt", "content-type": "text/plain" })
        response.end("download-ok")
        return
      }
      if (request.url === "/search") {
        response.writeHead(200, { "content-type": "text/html" })
        response.end('<div class="result"><a href="http://example.test/result"><h2>Result</h2></a><p>Snippet</p></div>')
        return
      }
      response.writeHead(200, { "content-type": "text/html" })
      response.end(html)
    })
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

async function main(): Promise<void> {
  const server = await listen()
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fixture server did not bind")
  const origin = `http://127.0.0.1:${address.port}`
  const outputDir = await mkdtemp(join(tmpdir(), "larify-all-tools-"))
  await app.whenReady()
  const window = new BrowserWindow({ show: true, x: -2000, y: -2000, width: 900, height: 700 })
  const recorder = new Recorder()
  let tab: BrowserTab | undefined
  let nextId = 1
  const tabs = new Map<number, BrowserTab>()
  const mount = (id: number): BrowserTab => {
    const created = new BrowserTab(id, `all-tools-${Date.now()}-${id}`)
    created.view.webContents.setBackgroundThrottling(false)
    window.contentView.addChildView(created.view)
    created.view.setBounds({ x: 0, y: 0, width: 900, height: 700 })
    tabs.set(id, created)
    tab = created
    return created
  }
  const service = {
    createTab: () => {
      const id = nextId++
      mount(id)
      return id
    },
    close: async (_sessionId: string, id: number) => {
      tabs.get(id)?.destroy(); tabs.delete(id)
    },
    state: () => ({ tabs: [...tabs.values()].map((item) => item.state()) }),
    tab: (_sessionId: string, id: number) => tabs.get(id),
    withRendered: async (_sessionId: string, _id: number, operation: () => Promise<unknown>) => operation(),
    withUnthrottled: async (_sessionId: string, _id: number, operation: () => Promise<unknown>) => operation(),
    withTemporaryTab: async (_sessionId: string, url: string, operation: (item: BrowserTab) => Promise<unknown>) => {
      const temporary = new BrowserTab(-nextId++, `all-tools-temp-${Date.now()}`)
      temporary.view.webContents.setBackgroundThrottling(false)
      try { await temporary.navigateAndWait(url); return await operation(temporary) } finally { temporary.destroy() }
    },
    readText: async () => undefined,
    recordStart: (_sessionId: string, item: BrowserTab, path: string) => recorder.start(item, path),
    recordRestart: (_sessionId: string, item: BrowserTab, path: string) => recorder.restart(item, path),
    recordStop: () => recorder.stop(),
    recordStopIfCurrent: (_sessionId: string, generation: number) => recorder.stopIfCurrent(generation),
  } as unknown as BrowserService
  const tools = createBrowserTools(service)
  const called = new Set<string>()
  const run = async (name: string, input: unknown): Promise<unknown> => {
    const tool = tools[name]
    if (!tool) throw new Error(`missing tool: ${name}`)
    const schema = tool.inputSchema as unknown as z.ZodTypeAny
    const execute = tool.execute as unknown as (args: unknown, options: unknown) => Promise<unknown>
    called.add(name)
    return execute(schema.parse(input), {
      context: { sessionId: "all-tools", cwd: outputDir }, toolCallId: `all-tools-${name}`, messages: []
    })
  }
  const evalValue = async (script: string): Promise<unknown> => tab!.evalJs(script)

  try {
    const created = await run("create_tab", { url: origin }) as { id: number }
    const id = created.id
    assert.equal(id, 1)
    assert.equal((await run("list_tabs", {}) as unknown[]).length, 1)
    await run("navigate", { id, action: "goto", url: `${origin}/page-one` })
    await run("navigate", { id, action: "goto", url: `${origin}/page-two` })
    await run("navigate", { id, action: "back" })
    assert.match(JSON.stringify(await run("list_tabs", {})), /page-one/)
    await run("navigate", { id, action: "forward" })
    assert.match(JSON.stringify(await run("list_tabs", {})), /page-two/)
    assert.equal((await run("navigate", { id, action: "reload" }) as { id: number }).id, id)
    assert.match(JSON.stringify(await run("snapshot", { id, includeUrls: true })), /All tools fixture/)
    const interactiveSnapshot = JSON.stringify(await run("snapshot", { id, interactive: true, compact: true, depth: 2, selector: "body" }))
    assert.match(interactiveSnapshot, /Click/)
    assert.match(JSON.stringify(await run("read_page", { id })), /All tools fixture/)
    assert.match(JSON.stringify(await run("eval_js", { id, script: "() => document.title = 'tools-ok'" })), /tools-ok/)
    assert.match(JSON.stringify(await run("cdp_call", { id, method: "Runtime.evaluate", params: { expression: "document.title", returnByValue: true } })), /tools-ok/)
    await run("cdp_call", { id, method: "Page.setLifecycleEventsEnabled", params: { enabled: true } })
    await run("navigate", { id, action: "reload" })
    assert.ok((await run("cdp_events", { id, filter: "Page.lifecycleEvent" }) as { count: number }).count > 0)
    assert.equal((await run("cdp_events", { id, filter: "Page.lifecycleEvent" }) as { count: number }).count, 0)
    await run("eval_js", { id, script: "() => { console.warn('tools-warning'); setTimeout(() => { throw new Error('tools-error') }, 0); return true }" })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok((await run("console", { id, level: "warning" }) as { count: number }).count > 0)
    assert.ok((await run("errors", { id }) as { count: number }).count > 0)
    assert.ok((await run("console", { id, limit: 1, clear: true }) as { count: number }).count <= 1)
    assert.equal((await run("console", { id }) as { count: number }).count, 0)
    assert.ok((await run("errors", { id, clear: true }) as { count: number }).count > 0)
    assert.equal((await run("errors", { id }) as { count: number }).count, 0)
    assert.deepEqual(await run("query_element", { id, selector: "#text", query: "value" }), { value: "old" })
    assert.match(JSON.stringify(await run("query_element", { id, selector: "h1", query: "text" })), /All tools fixture/)
    assert.match(JSON.stringify(await run("query_element", { id, selector: "#button", query: "html" })), /data-kind/)
    assert.equal((await run("query_element", { id, selector: "#button", query: "visible" }) as { visible: boolean }).visible, true)
    assert.equal((await run("query_element", { id, selector: "#disabled", query: "enabled" }) as { enabled: boolean }).enabled, false)
    assert.equal((await run("query_element", { id, selector: "#check", query: "checked" }) as { checked: boolean }).checked, false)
    assert.deepEqual(await run("query_element", { id, selector: "#button", query: "attr", name: "data-kind" }), { name: "data-kind", value: "action" })
    assert.match(JSON.stringify(await run("query_element", { id, selector: "#button", query: "styles", properties: ["color"] })), /255/)
    const initialBox = await run("query_element", { id, selector: "#button", query: "box" }) as { width: number; height: number }
    assert.ok(initialBox.width > 0 && initialBox.height > 0)
    await run("fill", { id, selector: "#text", text: "filled" })
    assert.equal(await tab!.getValue("#text"), "filled")
    await run("type", { id, selector: "#text", text: "typed", clear: true })
    assert.equal(await tab!.getValue("#text"), "typed")
    await run("element_action", { id, selector: "#text", action: "focus" })
    await run("press", { id, key: "Ctrl+A" })
    await run("keyboard_insert_text", { id, text: "inserted" })
    await run("keyboard_type", { id, text: "A!" })
    await run("keyboard_key", { id, action: "down", key: "Enter" })
    await run("keyboard_key", { id, action: "up", key: "Enter" })
    assert.equal(await tab!.getValue("#text"), "insertedA!")
    await run("click", { id, selector: "#button" })
    await run("element_action", { id, selector: "#button", action: "dblclick" })
    assert.equal(await tab!.evalJs("() => window.doubleClicks"), 1)
    await run("element_action", { id, selector: "#button", action: "hover" })
    assert.equal(await tab!.evalJs("() => document.querySelector('#button').matches(':hover')"), true)
    await run("element_action", { id, selector: "#check", action: "check" })
    assert.equal(await tab!.isChecked("#check"), true)
    await run("element_action", { id, selector: "#check", action: "uncheck" })
    assert.equal(await tab!.isChecked("#check"), false)
    await run("select", { id, selector: "#select", values: ["b"] })
    assert.equal(await tab!.getValue("#select"), "b")
    await run("element_action", { id, selector: "#bottom", action: "scroll_into_view" })
    assert.ok(Number(await evalValue("() => scrollY")) > 0)
    await run("element_action", { id, selector: "#bottom", action: "highlight" })
    assert.match(String(await evalValue("() => document.querySelector('#bottom').style.outline")), /solid/)
    await run("scroll", { id, direction: "up", amount: 100 })
    await run("scroll", { id, selector: "#scrollbox", direction: "down", amount: 80 })
    await run("scroll", { id, selector: "#scrollbox", direction: "right", amount: 70 })
    assert.deepEqual(await evalValue("() => { const e=document.querySelector('#scrollbox'); return [e.scrollLeft,e.scrollTop] }"), [70, 80])
    assert.deepEqual(await run("wait_for", { id, selector: "#button", state: "visible" }), { selector: "#button", state: "visible" })
    await run("wait_for", { id, selector: "#button", state: "attached" })
    await run("wait_for", { id, selector: "#hidden", state: "hidden" })
    await run("eval_js", { id, script: "() => { const e=document.createElement('div'); e.id='remove-me'; document.body.append(e); setTimeout(()=>e.remove(), 30); return true }" })
    await run("wait_for", { id, selector: "#remove-me", state: "detached", timeout: 2 })
    await run("drag", { id, source: "#drag", target: "#drop" })
    assert.equal(await tab!.evalJs("() => window.dropped"), "ok")
    const box = await run("query_element", { id, selector: "#button", query: "box" }) as { x: number; y: number; width: number; height: number }
    const clicksBeforeMouse = Number(await tab!.evalJs("() => window.clicks"))
    await run("mouse_move", { id, x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await run("mouse_button", { id, action: "down", button: "left" })
    await run("mouse_button", { id, action: "up", button: "left" })
    assert.equal(await tab!.evalJs("() => window.clicks"), clicksBeforeMouse + 1)
    await run("mouse_button", { id, action: "down", button: "right" })
    await run("mouse_button", { id, action: "up", button: "right" })
    assert.equal(await evalValue("() => window.contextMenus"), 1)
    await run("mouse_button", { id, action: "down", button: "middle" })
    await run("mouse_button", { id, action: "up", button: "middle" })
    assert.equal(await evalValue("() => window.auxClicks"), 1)
    const beforeWheel = Number(await tab!.evalJs("() => scrollY"))
    await run("mouse_wheel", { id, dy: 100 })
    assert.ok(Number(await tab!.evalJs("() => scrollY")) > beforeWheel)
    const uploadPath = join(outputDir, "upload.txt"); await writeFile(uploadPath, "upload-ok")
    await run("upload", { id, selector: "#upload", files: ["upload.txt"] })
    assert.equal(await tab!.evalJs("() => document.querySelector('#upload').files[0].name"), "upload.txt")
    const downloadPath = join(outputDir, "download.txt")
    await run("download", { id, selector: "#link", path: "download.txt", timeout: 5 })
    assert.equal(await readFile(downloadPath, "utf8"), "download-ok")
    const screenshotPath = join(outputDir, "page.png"); await run("screenshot", { id, path: screenshotPath, fullPage: true })
    const elementPath = join(outputDir, "element.png"); await run("screenshot", { id, path: elementPath, selector: "#button" })
    const jpegPath = join(outputDir, "viewport.jpg"); await run("screenshot", { id, path: jpegPath, format: "jpeg", quality: 70 })
    const pdfPath = join(outputDir, "page.pdf"); await run("pdf", { id, path: pdfPath })
    assert.equal((await readFile(screenshotPath)).subarray(1, 4).toString(), "PNG")
    assert.equal((await readFile(elementPath)).subarray(1, 4).toString(), "PNG")
    assert.equal((await readFile(jpegPath)).subarray(0, 2).toString("hex"), "ffd8")
    assert.equal((await readFile(pdfPath)).subarray(0, 4).toString(), "%PDF")
    const record1 = join(outputDir, "one.webm"); const record2 = join(outputDir, "two.webm")
    await run("record_start", { id, path: record1 }); await new Promise((resolve) => setTimeout(resolve, 400))
    await run("record_restart", { id, path: record2 }); await new Promise((resolve) => setTimeout(resolve, 400))
    await run("record_stop", {})
    assert.equal((await readFile(record1)).subarray(0, 4).toString("hex"), "1a45dfa3")
    assert.equal((await readFile(record2)).subarray(0, 4).toString("hex"), "1a45dfa3")
    const timedRecord = join(outputDir, "timed.webm")
    const timedResult = await run("record_start", { id, path: timedRecord, duration: 1 }) as { recording: boolean }
    assert.equal(timedResult.recording, false)
    assert.equal((await readFile(timedRecord)).subarray(0, 4).toString("hex"), "1a45dfa3")
    const temporaryScreenshot = await run("screenshot", { id }) as { path: string }
    const temporaryPdf = await run("pdf", { id }) as { path: string }
    assert.equal((await readFile(temporaryScreenshot.path)).subarray(1, 4).toString(), "PNG")
    assert.equal((await readFile(temporaryPdf.path)).subarray(0, 4).toString(), "%PDF")
    await rm(temporaryScreenshot.path, { force: true })
    await rm(temporaryPdf.path, { force: true })
    assert.match(JSON.stringify(await run("web_fetch", { url: origin })), /All tools fixture/)
    const search = await run("web_search", {
      pageUrl: `${origin}/search`,
      selectors: { result: ".result", title: "h2", link: "a", snippet: "p", nextPage: ".next" }
    }) as { results: Array<{ title: string; snippet?: string }> }
    assert.deepEqual(search.results, [{ title: "Result", url: "http://example.test/result", snippet: "Snippet" }])
    const opened = await run("click", { id, selector: "#pageLink", newTab: true }) as { id: number; url: string; newTab: boolean }
    assert.equal(opened.newTab, true)
    assert.equal(opened.url, `${origin}/page-two`)
    assert.match(JSON.stringify(await run("list_tabs", {})), /page-two/)
    await run("close_tab", { id: opened.id })
    await assert.rejects(run("click", { id, selector: "#button", newTab: true }), /no link target/)
    assert.equal((await run("list_tabs", {}) as unknown[]).length, 1)
    await assert.rejects(run("upload", { id, selector: "#upload", files: ["missing.txt"] }), /does not exist/)
    await assert.rejects(run("query_element", { id, selector: "#missing", query: "text" }), /not found|resolve/i)
    await assert.rejects(run("record_stop", {}), /no recording in progress/)
    await assert.rejects(run("close_tab", { id: 999999 }), /not found/)
    const blank = await run("create_tab", {}) as { id: number; url: string }
    assert.match(blank.url, /^about:blank/)
    await run("close_tab", { id: blank.id })
    await run("close_tab", { id })
    assert.equal((await run("list_tabs", {}) as unknown[]).length, 0)
    const missing = Object.keys(tools).filter((name) => !called.has(name))
    if (missing.length) throw new Error(`tools not called: ${missing.join(", ")}`)
    console.log(`PASS all ${called.size} browser tools through real execute entrypoints`)
  } finally {
    await recorder.destroy()
    for (const item of tabs.values()) item.destroy()
    window.destroy(); server.close(); await rm(outputDir, { recursive: true, force: true }); app.quit()
  }
}

void main().catch((error) => { console.error(error); app.exit(1) })
