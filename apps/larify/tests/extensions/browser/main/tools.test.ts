import { describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { z } from "zod"
import { createBrowserToolkit } from "../../../../src/extensions/browser/main/tools"
import type { BrowserService } from "../../../../src/extensions/browser/main/browser-service"
import type { Toolkit } from "../../../../src/shared/tool"

const ctx = { sessionId: "session-1" }

function createService(): BrowserService {
  const tabs = [
    {
      id: 1,
      url: "https://example.com",
      title: "Example",
      favIconUrl: "data:image/png;base64,abc",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    },
  ]
  return {
    state: vi.fn(() => ({
      activeId: 1,
      tabs,
    })),
    tab: vi.fn((_, id: number) => ({
      state: () => tabs.find((item) => item.id === id),
    })),
    createTab: vi.fn(() => 1),
    close: vi.fn(),
  } as unknown as BrowserService
}

function tool(name: string, service = createService()): Toolkit["tools"][number] {
  const found = createBrowserToolkit(service).tools.find((item) => item.name === name)
  if (!found) throw new Error(`Tool ${name} not found`)
  return found
}

function parseToolInput(name: string, input: unknown, service = createService()) {
  return (tool(name, service).inputSchema as z.ZodTypeAny).safeParse(input)
}

describe("browser toolkit", () => {
  it("exposes the migrated browser tool surface without browser_ prefixes", () => {
    expect(createBrowserToolkit(createService()).tools.map((item) => item.name).sort()).toEqual(
      [
        "back",
        "cdp_call",
        "cdp_events",
        "check",
        "click",
        "close_tab",
        "console",
        "create_tab",
        "dblclick",
        "download",
        "drag",
        "errors",
        "eval_js",
        "fill",
        "focus",
        "forward",
        "get_attr",
        "get_box",
        "get_count",
        "get_html",
        "get_styles",
        "get_text",
        "get_value",
        "highlight",
        "hover",
        "is_checked",
        "is_enabled",
        "is_visible",
        "keydown",
        "keyboard_insert_text",
        "keyboard_type",
        "keyup",
        "list_tabs",
        "mouse_down",
        "mouse_move",
        "mouse_up",
        "mouse_wheel",
        "navigate",
        "pdf",
        "press",
        "read_page",
        "record_restart",
        "record_start",
        "record_stop",
        "reload",
        "screenshot",
        "scroll",
        "scroll_into_view",
        "select",
        "snapshot",
        "type",
        "uncheck",
        "upload",
        "wait_for_download",
        "wait_for_function",
        "wait_for_load",
        "wait_for_selector",
        "wait_for_text",
        "wait_for_url",
        "wait",
      ].sort(),
    )
  })

  it("rejects unknown fields in public browser schemas", () => {
    expect(parseToolInput("create_tab", { url: "https://example.com", shell: "cmd.exe" }).success).toBe(
      false,
    )
    expect(parseToolInput("navigate", { id: 1, url: "https://example.com", tabId: 1 }).success).toBe(
      false,
    )
    expect(parseToolInput("click", { id: 1, selector: "button", wait: true }).success).toBe(false)
    expect(parseToolInput("cdp_call", { id: 1, method: "Runtime.evaluate", timeoutMs: 1000 }).success).toBe(
      false,
    )
    expect(parseToolInput("read_page", { id: 1, title: "Read page" }).success).toBe(false)
  })

  it("returns runtime tab lookup errors without throwing", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => null),
    } as unknown as BrowserService

    await expect(tool("navigate", service).execute({ id: 99, url: "https://example.com" }, ctx)).resolves.toEqual({
      error: 'Browser tab "99" not found.',
    })
    await expect(tool("snapshot", service).execute({ id: 99 }, ctx)).resolves.toEqual({
      error: 'Browser tab "99" not found.',
    })
    await expect(tool("get_text", service).execute({ id: 99, selector: "body" }, ctx)).resolves.toEqual({
      error: 'Browser tab "99" not found.',
    })
    await expect(tool("click", service).execute({ id: 99, selector: "button" }, ctx)).resolves.toEqual({
      error: 'Browser tab "99" not found.',
    })
  })

  it("exposes runtime tool errors when debug tool errors are enabled", async () => {
    const original = process.env.LARIFY_DEBUG_TOOL_ERRORS
    process.env.LARIFY_DEBUG_TOOL_ERRORS = "1"
    const service = {
      ...createService(),
      tab: vi.fn(() => null),
    } as unknown as BrowserService

    try {
      await expect(tool("navigate", service).execute({ id: 99, url: "https://example.com" }, ctx)).rejects.toThrow(
        'Browser tab "99" not found.',
      )
    } finally {
      if (original === undefined) delete process.env.LARIFY_DEBUG_TOOL_ERRORS
      else process.env.LARIFY_DEBUG_TOOL_ERRORS = original
    }
  })

  it("uses session scoped service calls and hides favicon data from agent list output", async () => {
    const service = createService()

    await expect(tool("create_tab", service).execute({ url: "https://example.com" }, ctx)).resolves.toEqual({
      id: 1,
      url: "https://example.com",
      title: "Example",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    })
    expect(service.createTab).toHaveBeenCalledWith("session-1", "https://example.com")

    await expect(tool("list_tabs", service).execute({}, ctx)).resolves.toEqual([
      {
        id: 1,
        url: "https://example.com",
        title: "Example",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: null,
      },
    ])
  })

  it("converts public browser wait timeouts from seconds to milliseconds", async () => {
    const waitForText = vi.fn()
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ waitForText })),
    } as unknown as BrowserService

    await expect(
      tool("wait_for_text", service).execute({ id: 1, text: "ready", timeout: 1.5 }, ctx),
    ).resolves.toEqual({ text: "ready" })

    expect(waitForText).toHaveBeenCalledWith("ready", 1500)
  })

  it("returns wait tool results in the original browser tool shapes", async () => {
    const tab = {
      waitForSelector: vi.fn(async () => undefined),
      waitForText: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      waitForUrl: vi.fn(async () => undefined),
      waitForLoad: vi.fn(async () => undefined),
      waitForDownload: vi.fn(async () => ({ path: "D:\\Downloads\\file.txt" })),
    }
    const service = {
      ...createService(),
      tab: vi.fn(() => tab),
    } as unknown as BrowserService

    await expect(tool("wait_for_selector", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      selector: "button",
      state: "visible",
    })
    await expect(tool("wait_for_function", service).execute({ id: 1, expression: "window.ready" }, ctx)).resolves.toEqual({
      expression: "window.ready",
    })
    await expect(tool("wait_for_url", service).execute({ id: 1, url: "**/dashboard" }, ctx)).resolves.toEqual({
      url: "**/dashboard",
    })
    await expect(tool("wait_for_load", service).execute({ id: 1, state: "networkidle" }, ctx)).resolves.toEqual({
      state: "networkidle",
    })
    await expect(tool("wait_for_download", service).execute({ id: 1, path: "D:\\Downloads\\file.txt" }, ctx)).resolves.toEqual({
      path: "D:\\Downloads\\file.txt",
    })
    await expect(tool("wait", service).execute({ seconds: 1.5 }, ctx)).resolves.toEqual({ waited: 1.5 })
  })

  it("returns wait errors without throwing", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => ({
        waitForText: vi.fn(async () => {
          throw new Error("timed out")
        }),
      })),
    } as unknown as BrowserService

    await expect(tool("wait_for_text", service).execute({ id: 1, text: "ready" }, ctx)).resolves.toEqual({
      error: "timed out",
    })
  })

  it("returns small browser snapshots inline", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ snapshot: vi.fn(async () => "button @e1 Submit") })),
    } as unknown as BrowserService

    await expect(tool("snapshot", service).execute({ id: 1 }, ctx)).resolves.toEqual({
      content: "button @e1 Submit",
    })
  })

  it("returns browser read page content through tool output handling", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => ({
        read: vi.fn(async () => ({
          url: "https://example.com",
          title: "Example",
          content: "# Example",
        })),
      })),
    } as unknown as BrowserService

    await expect(tool("read_page", service).execute({ id: 1 }, ctx)).resolves.toEqual({
      url: "https://example.com",
      title: "Example",
      content: "# Example",
    })
  })

  it("returns browser eval_js output through tool output handling", async () => {
    const value = { title: "Example", count: 2 }
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ evalJs: vi.fn(async () => value) })),
    } as unknown as BrowserService

    await expect(tool("eval_js", service).execute({ id: 1, script: "() => document.title" }, ctx)).resolves.toEqual({
      content: JSON.stringify(value, null, 2),
    })
  })

  it("returns cdp_call output through tool output handling", async () => {
    const value = { result: { value: "ok" } }
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ sendCdp: vi.fn(async () => value) })),
    } as unknown as BrowserService

    await expect(tool("cdp_call", service).execute({ id: 1, method: "Runtime.evaluate" }, ctx)).resolves.toEqual({
      content: JSON.stringify(value, null, 2),
    })
  })

  it("returns cdp_call errors with tab state", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => ({
        sendCdp: vi.fn(async () => {
          throw new Error("CDP failed")
        }),
        state: () => ({
          id: 1,
          url: "https://example.com",
          title: "Example",
          favIconUrl: "data:image/png;base64,abc",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          error: null,
        }),
      })),
    } as unknown as BrowserService

    await expect(tool("cdp_call", service).execute({ id: 1, method: "Runtime.evaluate" }, ctx)).resolves.toEqual({
      error: "CDP failed",
      tab: {
        id: 1,
        url: "https://example.com",
        title: "Example",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: null,
      },
    })
  })

  it("returns cdp_events through tool output handling", async () => {
    const events = [{ method: "Runtime.consoleAPICalled", params: { type: "log" } }]
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ drainCdpEvents: vi.fn(() => ({ events, dropped: 2 })) })),
    } as unknown as BrowserService

    await expect(tool("cdp_events", service).execute({ id: 1, filter: "Runtime." }, ctx)).resolves.toEqual({
      count: 1,
      dropped: 2,
      content: JSON.stringify(events, null, 2),
    })
  })

  it("returns console messages through tool output handling", async () => {
    const entries = [{ type: "log", text: "hello" }]
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ readConsole: vi.fn(() => ({ entries, dropped: 1 })) })),
    } as unknown as BrowserService

    await expect(tool("console", service).execute({ id: 1, level: "log", limit: 1 }, ctx)).resolves.toEqual({
      count: 1,
      dropped: 1,
      content: JSON.stringify(entries, null, 2),
    })
    expect(parseToolInput("console", { id: 1, limit: 0 }).success).toBe(false)
  })

  it("returns JavaScript errors through tool output handling", async () => {
    const entries = [{ message: "boom", line: 1 }]
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ readErrors: vi.fn(() => ({ entries, dropped: 0 })) })),
    } as unknown as BrowserService

    await expect(tool("errors", service).execute({ id: 1 }, ctx)).resolves.toEqual({
      count: 1,
      dropped: 0,
      content: JSON.stringify(entries, null, 2),
    })
  })

  it("returns query tool results in the original browser tool shapes", async () => {
    const styles = { color: "red" }
    const tab = {
      getText: vi.fn(async () => "visible text"),
      getHtml: vi.fn(async () => "<button>Submit</button>"),
      getValue: vi.fn(async () => "typed"),
      getBox: vi.fn(async () => ({ x: 1, y: 2, width: 3, height: 4 })),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => false),
      isChecked: vi.fn(async () => true),
      getCount: vi.fn(async () => 2),
      getAttr: vi.fn(async () => "button"),
      getStyles: vi.fn(async () => styles),
    }
    const service = {
      ...createService(),
      tab: vi.fn(() => tab),
    } as unknown as BrowserService

    await expect(tool("get_text", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      content: "visible text",
    })
    await expect(tool("get_html", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      content: "<button>Submit</button>",
    })
    await expect(tool("get_value", service).execute({ id: 1, selector: "input" }, ctx)).resolves.toEqual({
      value: "typed",
    })
    await expect(tool("get_box", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    })
    await expect(tool("is_visible", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      visible: true,
    })
    await expect(tool("is_enabled", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      enabled: false,
    })
    await expect(tool("is_checked", service).execute({ id: 1, selector: "input" }, ctx)).resolves.toEqual({
      checked: true,
    })
    await expect(tool("get_count", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      count: 2,
    })
    await expect(tool("get_attr", service).execute({ id: 1, selector: "button", name: "role" }, ctx)).resolves.toEqual({
      name: "role",
      value: "button",
    })
    await expect(tool("get_styles", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      content: JSON.stringify(styles, null, 2),
    })
  })

  it("returns interaction tool results in the original browser tool shapes", async () => {
    const tab = {
      click: vi.fn(async () => undefined),
      elementHref: vi.fn(async () => "https://example.com/next"),
      dblclick: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      focus: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
      uncheck: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
      select: vi.fn(async () => undefined),
      scroll: vi.fn(async () => undefined),
      scrollIntoView: vi.fn(async () => undefined),
      highlight: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      upload: vi.fn(async () => undefined),
      download: vi.fn(async () => "D:\\Downloads\\file.txt"),
    }
    const service = {
      ...createService(),
      tab: vi.fn(() => tab),
      createTab: vi.fn(() => 2),
    } as unknown as BrowserService

    await expect(tool("click", service).execute({ id: 1, selector: "a" }, ctx)).resolves.toEqual({
      clicked: "a",
    })
    await expect(tool("click", service).execute({ id: 1, selector: "a", newTab: true }, ctx)).resolves.toEqual({
      clicked: "a",
      newTab: true,
      id: 2,
      url: "https://example.com/next",
    })
    await expect(tool("dblclick", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      clicked: "button",
    })
    await expect(tool("hover", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      hovered: "button",
    })
    await expect(tool("focus", service).execute({ id: 1, selector: "input" }, ctx)).resolves.toEqual({
      focused: "input",
    })
    await expect(tool("check", service).execute({ id: 1, selector: "input" }, ctx)).resolves.toEqual({
      checked: "input",
    })
    await expect(tool("uncheck", service).execute({ id: 1, selector: "input" }, ctx)).resolves.toEqual({
      unchecked: "input",
    })
    await expect(tool("fill", service).execute({ id: 1, selector: "input", text: "hello" }, ctx)).resolves.toEqual({
      filled: "input",
    })
    await expect(tool("type", service).execute({ id: 1, selector: "input", text: "hello" }, ctx)).resolves.toEqual({
      typed: "hello",
    })
    await expect(tool("press", service).execute({ id: 1, key: "Enter" }, ctx)).resolves.toEqual({
      pressed: "Enter",
    })
    await expect(tool("select", service).execute({ id: 1, selector: "select", values: ["a"] }, ctx)).resolves.toEqual({
      selected: ["a"],
    })
    await expect(tool("scroll", service).execute({ id: 1 }, ctx)).resolves.toEqual({
      scrolled: true,
    })
    await expect(tool("scroll_into_view", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      scrolled: "button",
    })
    await expect(tool("highlight", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      highlighted: "button",
    })
    await expect(tool("drag", service).execute({ id: 1, source: "#a", target: "#b" }, ctx)).resolves.toEqual({
      dragged: true,
      source: "#a",
      target: "#b",
    })
    await expect(tool("upload", service).execute({ id: 1, selector: "input", files: ["D:\\a.txt"] }, ctx)).resolves.toEqual({
      uploaded: 1,
    })
    await expect(tool("download", service).execute({ id: 1, selector: "a", path: "D:\\Downloads\\file.txt" }, ctx)).resolves.toEqual({
      path: "D:\\Downloads\\file.txt",
    })

    expect(parseToolInput("select", { id: 1, selector: "select", values: [] }).success).toBe(false)
    expect(parseToolInput("upload", { id: 1, selector: "input", files: [] }).success).toBe(false)
  })

  it("returns interaction errors without throwing", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => ({
        click: vi.fn(async () => {
          throw new Error("element not found")
        }),
      })),
    } as unknown as BrowserService

    await expect(tool("click", service).execute({ id: 1, selector: "missing" }, ctx)).resolves.toEqual({
      error: "element not found",
    })
  })

  it("returns capture tool results in the original browser tool shapes", async () => {
    const image = Buffer.from("png-data")
    const pdf = Buffer.from("pdf-data")
    const video = Buffer.from("webm-data")
    const recordPath = join(tmpdir(), "larify-browser-tools-test.webm")
    const tab = {
      screenshot: vi.fn(async () => ({ data: image.toString("base64"), mimeType: "image/png" })),
      pdf: vi.fn(async () => pdf),
    }
    const service = {
      ...createService(),
      tab: vi.fn(() => tab),
      recordStart: vi.fn(async () => undefined),
      recordStop: vi.fn(async () => ({ path: recordPath, data: video })),
      recordRestart: vi.fn(async () => undefined),
    } as unknown as BrowserService

    const screenshot = (await tool("screenshot", service).execute({ id: 1 }, ctx)) as { path: string; bytes: number }
    expect(screenshot.bytes).toBe(image.length)
    expect(existsSync(screenshot.path)).toBe(true)

    const pdfResult = (await tool("pdf", service).execute({ id: 1 }, ctx)) as { path: string; bytes: number }
    expect(pdfResult.bytes).toBe(pdf.length)
    expect(existsSync(pdfResult.path)).toBe(true)

    await expect(tool("record_start", service).execute({ id: 1, path: recordPath }, ctx)).resolves.toEqual({
      recording: true,
      path: recordPath,
    })
    await expect(tool("record_stop", service).execute({}, ctx)).resolves.toEqual({
      path: recordPath,
      bytes: video.length,
    })
    await expect(tool("record_restart", service).execute({ id: 1, path: recordPath }, ctx)).resolves.toEqual({
      recording: true,
      path: recordPath,
    })

    expect(parseToolInput("screenshot", { id: 1, quality: -1 }).success).toBe(false)
    expect(parseToolInput("screenshot", { id: 1, quality: 101 }).success).toBe(false)
    expect(parseToolInput("screenshot", { id: 1, quality: 0 }).success).toBe(true)
  })

  it("returns capture errors without throwing", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => ({
        screenshot: vi.fn(async () => {
          throw new Error("capture failed")
        }),
      })),
    } as unknown as BrowserService

    await expect(tool("screenshot", service).execute({ id: 1 }, ctx)).resolves.toEqual({
      error: "capture failed",
    })
  })

  it("returns input tool results in the original browser tool shapes", async () => {
    const tab = {
      keyDown: vi.fn(async () => undefined),
      keyUp: vi.fn(async () => undefined),
      keyboardType: vi.fn(async () => undefined),
      keyboardInsertText: vi.fn(async () => undefined),
      mouseMove: vi.fn(async () => undefined),
      mouseDown: vi.fn(async () => undefined),
      mouseUp: vi.fn(async () => undefined),
      mouseWheel: vi.fn(async () => undefined),
    }
    const service = {
      ...createService(),
      tab: vi.fn(() => tab),
    } as unknown as BrowserService

    await expect(tool("keydown", service).execute({ id: 1, key: "Shift" }, ctx)).resolves.toEqual({
      down: "Shift",
    })
    await expect(tool("keyup", service).execute({ id: 1, key: "Shift" }, ctx)).resolves.toEqual({
      up: "Shift",
    })
    await expect(tool("keyboard_type", service).execute({ id: 1, text: "hello" }, ctx)).resolves.toEqual({
      typed: "hello",
    })
    await expect(tool("keyboard_insert_text", service).execute({ id: 1, text: "hello" }, ctx)).resolves.toEqual({
      inserted: "hello",
    })
    await expect(tool("mouse_move", service).execute({ id: 1, x: 10, y: 20 }, ctx)).resolves.toEqual({
      x: 10,
      y: 20,
    })
    await expect(tool("mouse_down", service).execute({ id: 1 }, ctx)).resolves.toEqual({
      down: "left",
    })
    await expect(tool("mouse_up", service).execute({ id: 1, button: "right" }, ctx)).resolves.toEqual({
      up: "right",
    })
    await expect(tool("mouse_wheel", service).execute({ id: 1, dy: 100 }, ctx)).resolves.toEqual({
      dx: 0,
      dy: 100,
    })
  })

  it("returns input errors without throwing", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => ({
        keyDown: vi.fn(async () => {
          throw new Error("key failed")
        }),
      })),
    } as unknown as BrowserService

    await expect(tool("keydown", service).execute({ id: 1, key: "Enter" }, ctx)).resolves.toEqual({
      error: "key failed",
    })
  })

  it("spills large browser snapshots to a file", async () => {
    const content = "x".repeat(31_000)
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ snapshot: vi.fn(async () => content) })),
    } as unknown as BrowserService

    const result = await tool("snapshot", service).execute({ id: 1 }, ctx)

    expect(result).toMatchObject({
      bytes: Buffer.byteLength(content, "utf8"),
      preview: content.slice(0, 1500),
    })
    expect(typeof (result as { path?: unknown }).path).toBe("string")
    expect(readFileSync((result as { path: string }).path, "utf8")).toBe(content)
  })
})
