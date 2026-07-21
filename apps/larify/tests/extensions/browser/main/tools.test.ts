import { describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { z } from "zod"
import { createBrowserToolkit } from "../../../../src/extensions/browser/main/tools"
import type { BrowserService } from "../../../../src/extensions/browser/main/browser-service"

const ctx = { context: { sessionId: "session-1", cwd: "D:\\Workspace" } }

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
      navigateAndWait: vi.fn(async () => undefined),
      waitForNavigation: vi.fn(async () => undefined),
    })),
    createTab: vi.fn(() => 1),
    close: vi.fn(),
  } as unknown as BrowserService
}

function tool(name: string, service = createService()) {
  const found = createBrowserToolkit(service).tools[name]
  if (!found) throw new Error(`Tool ${name} not found`)
  const inputSchema = found.inputSchema as unknown as z.ZodTypeAny
  const rawExecute = found.execute as unknown as (input: unknown, options: unknown) => Promise<unknown>
  return {
    inputSchema,
    execute: (
      input: unknown,
      options: { context: { sessionId: string; cwd: string }; abortSignal?: AbortSignal },
    ) => rawExecute(inputSchema.parse(input), { ...options, toolCallId: "test", messages: [] }),
  }
}

function parseToolInput(name: string, input: unknown, service = createService()) {
  return tool(name, service).inputSchema.safeParse(input)
}

describe("browser toolkit", () => {
  it("exposes the migrated browser tool surface without browser_ prefixes", () => {
    expect(Object.keys(createBrowserToolkit(createService()).tools).sort()).toEqual(
      [
        "cdp_call",
        "cdp_events",
        "click",
        "close_tab",
        "console",
        "create_tab",
        "download",
        "drag",
        "element_action",
        "errors",
        "eval_js",
        "fill",
        "keyboard_key",
        "keyboard_insert_text",
        "keyboard_type",
        "list_tabs",
        "mouse_button",
        "mouse_move",
        "mouse_wheel",
        "navigate",
        "pdf",
        "press",
        "query_element",
        "read_page",
        "record_restart",
        "record_start",
        "record_stop",
        "screenshot",
        "scroll",
        "select",
        "snapshot",
        "type",
        "upload",
        "wait_for",
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
    expect(parseToolInput("navigate", { id: 1 }).success).toBe(false)
    expect(parseToolInput("navigate", { id: 1, action: "back" }).success).toBe(true)
    expect(parseToolInput("click", { id: 1, selector: "button", wait: true }).success).toBe(false)
    expect(parseToolInput("query_element", { id: 1, selector: "button", query: "attr" }).success).toBe(false)
    expect(
      parseToolInput("query_element", { id: 1, selector: "button", query: "text", name: "href" }).success,
    ).toBe(false)
    expect(
      parseToolInput("query_element", { id: 1, selector: "button", query: "text", properties: ["color"] }).success,
    ).toBe(false)
    expect(parseToolInput("query_element", { id: 1, selector: "button", query: "count" }).success).toBe(false)
    expect(parseToolInput("element_action", { id: 1, selector: "button", action: "click" }).success).toBe(false)
    expect(parseToolInput("drag", { id: 1, source: "", target: "#b" }).success).toBe(false)
    expect(parseToolInput("drag", { id: 1, source: "#a", target: "" }).success).toBe(false)
    expect(parseToolInput("upload", { id: 1, selector: "input", files: [] }).success).toBe(false)
    expect(parseToolInput("upload", { id: 1, selector: "input", files: [""] }).success).toBe(false)
    expect(parseToolInput("download", { id: 1, selector: "a", path: "" }).success).toBe(false)
    expect(parseToolInput("download", { id: 1, selector: "a", path: "D:\\file.txt", timeoutMs: 1000 }).success).toBe(
      false,
    )
    expect(parseToolInput("select", { id: 1, selector: "select", values: [] }).success).toBe(false)
    expect(parseToolInput("select", { id: 1, selector: "select", values: [""] }).success).toBe(false)
    expect(parseToolInput("scroll", { id: 1, direction: "down", amount: 0 }).success).toBe(false)
    expect(parseToolInput("wait_for", { id: 1 }).success).toBe(false)
    expect(parseToolInput("wait_for", { id: 1, selector: "button", text: "ready" }).success).toBe(false)
    expect(parseToolInput("wait_for", { id: 1, selector: "button", state: "load" }).success).toBe(false)
    expect(parseToolInput("wait_for", { id: 1, condition: "download", path: "D:\\file.txt" }).success).toBe(false)
    expect(parseToolInput("type", { id: 1, selector: "input", text: "hello", delayMs: 100 }).success).toBe(false)
    expect(parseToolInput("cdp_call", { id: 1, method: "Runtime.evaluate", timeoutMs: 1000 }).success).toBe(
      false,
    )
    expect(parseToolInput("read_page", { id: 1, title: "Read page" }).success).toBe(false)
  })

  it("uses interaction-focused snapshot defaults", () => {
    expect(parseToolInput("snapshot", { id: 1 }).data).toMatchObject({
      id: 1,
      interactive: true,
      includeUrls: false,
      compact: false,
    })
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
    await expect(
      tool("query_element", service).execute({ id: 99, selector: "body", query: "text" }, ctx),
    ).resolves.toEqual({
      error: 'Browser tab "99" not found.',
    })
    await expect(tool("click", service).execute({ id: 99, selector: "button" }, ctx)).resolves.toEqual({
      error: 'Browser tab "99" not found.',
    })
  })

  it("navigates with goto, back, forward, and reload actions", async () => {
    const tab = {
      state: vi.fn(() => ({
        id: 1,
        url: "https://example.com",
        title: "Example",
        favIconUrl: "data:image/png;base64,abc",
        loading: false,
        canGoBack: true,
        canGoForward: false,
        error: null,
      })),
      navigateAndWait: vi.fn(async () => undefined),
      goBackAndWait: vi.fn(async () => undefined),
      goForwardAndWait: vi.fn(async () => undefined),
      reloadAndWait: vi.fn(async () => undefined),
    }
    const service = {
      ...createService(),
      tab: vi.fn(() => tab),
    } as unknown as BrowserService

    const expected = {
      id: 1,
      url: "https://example.com",
      title: "Example",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      error: null,
    }

    await expect(tool("navigate", service).execute({ id: 1, url: "https://example.com" }, ctx)).resolves.toEqual(
      expected,
    )
    await expect(tool("navigate", service).execute({ id: 1, action: "back" }, ctx)).resolves.toEqual(expected)
    await expect(tool("navigate", service).execute({ id: 1, action: "forward" }, ctx)).resolves.toEqual(expected)
    await expect(tool("navigate", service).execute({ id: 1, action: "reload" }, ctx)).resolves.toEqual(expected)

    expect(tab.navigateAndWait).toHaveBeenCalledWith("https://example.com")
    expect(tab.goBackAndWait).toHaveBeenCalledTimes(1)
    expect(tab.goForwardAndWait).toHaveBeenCalledTimes(1)
    expect(tab.reloadAndWait).toHaveBeenCalledTimes(1)
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
    const waitForSelector = vi.fn()
    const service = {
      ...createService(),
      tab: vi.fn(() => ({ waitForSelector })),
    } as unknown as BrowserService

    await expect(
      tool("wait_for", service).execute({ id: 1, selector: "button", timeout: 1.5 }, ctx),
    ).resolves.toEqual({ selector: "button", state: "visible" })

    expect(waitForSelector).toHaveBeenCalledWith("button", "visible", 1500)
  })

  it("returns wait tool results in the browser tool shape", async () => {
    const tab = {
      waitForSelector: vi.fn(async () => undefined),
    }
    const service = {
      ...createService(),
      tab: vi.fn(() => tab),
    } as unknown as BrowserService

    await expect(tool("wait_for", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
      selector: "button",
      state: "visible",
    })
  })

  it("returns wait errors without throwing", async () => {
    const service = {
      ...createService(),
      tab: vi.fn(() => ({
        waitForSelector: vi.fn(async () => {
          throw new Error("timed out")
        }),
      })),
    } as unknown as BrowserService

    await expect(tool("wait_for", service).execute({ id: 1, selector: "button" }, ctx)).resolves.toEqual({
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

  it("returns query element results in the original browser tool shapes", async () => {
    const styles = { color: "red" }
    const tab = {
      getText: vi.fn(async () => "visible text"),
      getHtml: vi.fn(async () => "<button>Submit</button>"),
      getValue: vi.fn(async () => "typed"),
      getBox: vi.fn(async () => ({ x: 1, y: 2, width: 3, height: 4 })),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => false),
      isChecked: vi.fn(async () => true),
      getAttr: vi.fn(async () => "button"),
      getStyles: vi.fn(async () => styles),
    }
    const service = {
      ...createService(),
      tab: vi.fn(() => tab),
    } as unknown as BrowserService

    await expect(tool("query_element", service).execute({ id: 1, selector: "button", query: "text" }, ctx)).resolves.toEqual({
      content: "visible text",
    })
    await expect(tool("query_element", service).execute({ id: 1, selector: "button", query: "html" }, ctx)).resolves.toEqual({
      content: "<button>Submit</button>",
    })
    await expect(tool("query_element", service).execute({ id: 1, selector: "input", query: "value" }, ctx)).resolves.toEqual({
      value: "typed",
    })
    await expect(tool("query_element", service).execute({ id: 1, selector: "button", query: "box" }, ctx)).resolves.toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    })
    await expect(tool("query_element", service).execute({ id: 1, selector: "button", query: "visible" }, ctx)).resolves.toEqual({
      visible: true,
    })
    await expect(tool("query_element", service).execute({ id: 1, selector: "button", query: "enabled" }, ctx)).resolves.toEqual({
      enabled: false,
    })
    await expect(tool("query_element", service).execute({ id: 1, selector: "input", query: "checked" }, ctx)).resolves.toEqual({
      checked: true,
    })
    await expect(
      tool("query_element", service).execute({ id: 1, selector: "button", query: "attr", name: "role" }, ctx),
    ).resolves.toEqual({
      name: "role",
      value: "button",
    })
    await expect(tool("query_element", service).execute({ id: 1, selector: "button", query: "styles" }, ctx)).resolves.toEqual({
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
    for (const action of ["dblclick", "hover", "focus", "check", "uncheck", "scroll_into_view", "highlight"]) {
      await expect(
        tool("element_action", service).execute({ id: 1, selector: "button", action }, ctx),
      ).resolves.toEqual({
        action,
        selector: "button",
      })
    }
    await expect(tool("fill", service).execute({ id: 1, selector: "input", text: "hello" }, ctx)).resolves.toEqual({
      filled: "input",
    })
    await expect(
      tool("type", service).execute({ id: 1, selector: "input", text: "hello", delay: 0.25 }, ctx),
    ).resolves.toEqual({
      typed: "hello",
    })
    expect(tab.type).toHaveBeenCalledWith("input", "hello", false, 250)
    await expect(tool("press", service).execute({ id: 1, key: "Enter" }, ctx)).resolves.toEqual({
      pressed: "Enter",
    })
    await expect(tool("select", service).execute({ id: 1, selector: "select", values: ["a"] }, ctx)).resolves.toEqual({
      selected: ["a"],
    })
    await expect(tool("scroll", service).execute({ id: 1 }, ctx)).resolves.toEqual({
      scrolled: true,
    })
    await expect(tool("drag", service).execute({ id: 1, source: "#a", target: "#b" }, ctx)).resolves.toEqual({
      dragged: true,
      source: "#a",
      target: "#b",
    })
    await expect(tool("upload", service).execute({ id: 1, selector: "input", files: ["D:\\a.txt"] }, ctx)).resolves.toEqual({
      uploaded: 1,
    })
    await expect(
      tool("download", service).execute(
        { id: 1, selector: "a", path: "D:\\Downloads\\file.txt", timeout: 45 },
        ctx,
      ),
    ).resolves.toEqual({
      path: "D:\\Downloads\\file.txt",
    })
    expect(tab.download).toHaveBeenCalledWith("a", "D:\\Downloads\\file.txt", 45_000)
    await expect(
      tool("download", service).execute({ id: 1, selector: "a", path: "D:\\Downloads\\default.txt" }, ctx),
    ).resolves.toEqual({
      path: "D:\\Downloads\\file.txt",
    })
    expect(tab.download).toHaveBeenCalledWith("a", "D:\\Downloads\\default.txt", 1_800_000)
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
      recordStop: vi.fn(async () => ({ path: recordPath, bytes: video.length })),
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

  it("auto-stops record_start when a duration is given and returns the finished recording", async () => {
    vi.useFakeTimers()
    const recordPath = join(tmpdir(), "larify-record-duration-test.webm")
    const service = {
      ...createService(),
      tab: vi.fn(() => ({})),
      recordStart: vi.fn(async () => undefined),
      recordStop: vi.fn(async () => ({ path: recordPath, bytes: 42 })),
    } as unknown as BrowserService

    const pending = tool("record_start", service).execute(
      { id: 1, path: recordPath, duration: 1 },
      ctx,
    )
    await vi.advanceTimersByTimeAsync(1000)
    const result = await pending

    expect(service.recordStart).toHaveBeenCalledTimes(1)
    expect(service.recordStop).toHaveBeenCalledWith(ctx.context.sessionId)
    expect(result).toEqual({ path: recordPath, bytes: 42 })
    vi.useRealTimers()
  })

  it("does not report an error when the recording is stopped elsewhere during the duration wait", async () => {
    vi.useFakeTimers()
    const recordPath = join(tmpdir(), "larify-record-raced-test.webm")
    const service = {
      ...createService(),
      tab: vi.fn(() => ({})),
      recordStart: vi.fn(async () => undefined),
      recordStop: vi.fn(async () => {
        throw new Error("no recording in progress")
      }),
    } as unknown as BrowserService

    const pending = tool("record_start", service).execute(
      { id: 1, path: recordPath, duration: 1 },
      ctx,
    )
    await vi.advanceTimersByTimeAsync(1000)
    const result = await pending

    expect(service.recordStop).toHaveBeenCalledWith(ctx.context.sessionId)
    expect(result).toEqual({ recording: false, path: recordPath })
    vi.useRealTimers()
  })

  it("stops the recording promptly when the tool is aborted during the duration wait", async () => {
    const recordPath = join(tmpdir(), "larify-record-abort-test.webm")
    const service = {
      ...createService(),
      tab: vi.fn(() => ({})),
      recordStart: vi.fn(async () => undefined),
      recordStop: vi.fn(async () => ({ path: recordPath, bytes: 7 })),
    } as unknown as BrowserService
    const controller = new AbortController()
    controller.abort()

    const result = await tool("record_start", service).execute(
      { id: 1, path: recordPath, duration: 600 },
      { context: { sessionId: "session-1", cwd: "D:\\Workspace" }, abortSignal: controller.signal },
    )

    expect(service.recordStop).toHaveBeenCalledWith("session-1")
    expect(result).toEqual({ path: recordPath, bytes: 7 })
  })

  it("rejects a record duration over the 600s cap", () => {
    expect(parseToolInput("record_start", { id: 1, path: "x.webm", duration: 601 }).success).toBe(false)
    expect(parseToolInput("record_start", { id: 1, path: "x.webm", duration: 5 }).success).toBe(true)
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

    await expect(tool("keyboard_key", service).execute({ id: 1, action: "down", key: "Shift" }, ctx)).resolves.toEqual({
      action: "down",
      key: "Shift",
    })
    await expect(tool("keyboard_key", service).execute({ id: 1, action: "up", key: "Shift" }, ctx)).resolves.toEqual({
      action: "up",
      key: "Shift",
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
    await expect(tool("mouse_button", service).execute({ id: 1, action: "down" }, ctx)).resolves.toEqual({
      action: "down",
      button: "left",
    })
    await expect(tool("mouse_button", service).execute({ id: 1, action: "up", button: "right" }, ctx)).resolves.toEqual({
      action: "up",
      button: "right",
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

    await expect(tool("keyboard_key", service).execute({ id: 1, action: "down", key: "Enter" }, ctx)).resolves.toEqual({
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
