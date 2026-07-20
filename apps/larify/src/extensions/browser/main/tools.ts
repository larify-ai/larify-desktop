import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Toolkit } from "../../../shared/tool"
import { larifyTempPath } from "../../../main/utils/app-paths"
import { prepareToolOutput } from "../../../main/utils/tool-output"
import type { BrowserService } from "./browser-service"
import type { BrowserTab } from "./tab"

const idSchema = z.number().int().positive().describe("Browser tab id")
const elementTargetSchema = z
  .string()
  .min(1)
  .describe('Element selector. Use CSS selector, xpath=..., or snapshot ref like "e2".')
const cssSelectorSchema = z.string().min(1).describe("CSS selector")
const timeoutSchema = z.number().positive().optional().describe("Timeout in seconds")

type BrowserServiceProvider = BrowserService | (() => BrowserService)

const resolveService = (provider: BrowserServiceProvider): BrowserService =>
  typeof provider === "function" ? provider() : provider

const secondsToMs = (seconds: number | undefined): number | undefined =>
  seconds === undefined ? undefined : seconds * 1000

const navigateSchema = z
  .object({
    id: idSchema,
    action: z.enum(["goto", "back", "forward", "reload"]).default("goto"),
    url: z.string().min(1).optional().describe('URL or local file path. Required when action is "goto".'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action !== "goto" || value.url) return
    ctx.addIssue({
      code: "custom",
      path: ["url"],
      message: 'URL is required when action is "goto".',
    })
  })

const tabIdInputSchema = z.object({ id: idSchema }).strict()

const snapshotSchema = z
  .object({
    id: idSchema,
    interactive: z.boolean().default(true).describe("Only interactive elements."),
    includeUrls: z.boolean().default(false).describe("Include href URLs for links."),
    compact: z.boolean().default(false).describe("Remove empty structural elements."),
    depth: z.number().int().positive().optional().describe("Limit tree depth."),
    selector: cssSelectorSchema.optional(),
  })
  .strict()

const evalSchema = z
  .object({
    id: idSchema,
    script: z.string().describe("JavaScript function source"),
    sessionId: z.string().optional(),
  })
  .strict()

const cdpCallSchema = z
  .object({
    id: idSchema,
    method: z.string().min(1).describe("CDP method name"),
    params: z.record(z.string(), z.unknown()).optional().describe("JSON object with request parameters"),
    sessionId: z.string().optional().describe("Debugging session id of a frame/worker target"),
    timeout: timeoutSchema,
  })
  .strict()

const cdpEventsSchema = z
  .object({
    id: idSchema,
    filter: z.string().optional().describe("Only return events whose method starts with this prefix"),
  })
  .strict()

const consoleSchema = z
  .object({
    id: idSchema,
    level: z.enum(["log", "info", "warning", "error", "debug"]).optional(),
    limit: z.number().int().positive().optional().describe("Return only the last N messages."),
    clear: z.boolean().default(false).describe("Clear the buffer after reading."),
  })
  .strict()

const errorsSchema = z
  .object({
    id: idSchema,
    clear: z.boolean().default(false).describe("Clear the buffer after reading."),
  })
  .strict()

const spill = (content: string, extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const output = prepareToolOutput(content)
  if ("inline" in output) return { ...extra, content: output.inline }
  return { ...extra, path: output.path, bytes: output.bytes, preview: output.preview }
}

const tabState = (tab: BrowserTab) => {
  const { favIconUrl: _favIconUrl, ...state } = tab.state()
  return state
}

const getTab = (provider: BrowserServiceProvider, sessionId: string, id: number): BrowserTab => {
  const service = resolveService(provider)
  const tab = service.tab(sessionId, id)
  if (!tab) throw new Error(`Browser tab "${id}" not found.`)
  return tab
}

const shouldExposeToolErrors = (): boolean => process.env.LARIFY_DEBUG_TOOL_ERRORS === "1"

const errorResult = (error: unknown): { error: string } => {
  if (shouldExposeToolErrors()) throw error
  return { error: error instanceof Error ? error.message : String(error) }
}

async function withTab<T>(
  service: BrowserServiceProvider,
  sessionId: string,
  id: number,
  action: (tab: BrowserTab) => Promise<T> | T,
): Promise<T | { error: string }> {
  try {
    return await action(getTab(service, sessionId, id))
  } catch (error) {
    return errorResult(error)
  }
}

const tempPath = (extension: string): string =>
  join(larifyTempPath("browser"), `${randomUUID()}.${extension}`)

async function writeBytes(path: string, data: Buffer): Promise<{ path: string; bytes: number }> {
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  await writeFile(path, data)
  return { path, bytes: data.length }
}

async function writeDataUrl(
  path: string,
  data: string,
  mimeType: string,
): Promise<{ path: string; bytes: number }> {
  return writeBytes(path, Buffer.from(data, mimeType.startsWith("text/") ? "utf8" : "base64"))
}

export function createBrowserToolkit(service: BrowserServiceProvider): Toolkit {
  return {
    name: "browser",
    description: "Create browser tabs, navigate pages, inspect content, and interact with web pages",
    tools: [
      {
        name: "create_tab",
        description:
          "Open a new browser tab, optionally navigating to a URL or local file path.",
        metadata: { icon: "browser" },
        inputSchema: z.object({ url: z.string().optional().describe("URL or local file path") }).strict(),
        execute: async (args, ctx) => {
          const { url } = z.object({ url: z.string().optional() }).strict().parse(args)
          try {
            const resolved = resolveService(service)
            const id = resolved.createTab(ctx.sessionId, url)
            const tab = getTab(service, ctx.sessionId, id)
            if (url) await tab.waitForNavigation()
            return tabState(tab)
          } catch (error) {
            return errorResult(error)
          }
        },
      },
      {
        name: "close_tab",
        description: "Close a browser tab by id.",
        metadata: { icon: "browser" },
        inputSchema: z.object({ id: idSchema }).strict(),
        execute: async (args, ctx) => {
          const { id } = z.object({ id: idSchema }).strict().parse(args)
          return withTab(service, ctx.sessionId, id, () => {
            resolveService(service).close(ctx.sessionId, id)
            return `Closed browser tab ${id}.`
          })
        },
      },
      {
        name: "list_tabs",
        description: "List all open browser tabs with their navigation state.",
        metadata: { icon: "browser" },
        inputSchema: z.object({}).strict(),
        execute: async (_args, ctx) =>
          resolveService(service).state(ctx.sessionId).tabs.map(({ favIconUrl, ...tab }) => tab),
      },
      {
        name: "navigate",
        description: "Navigate a browser tab: goto a URL, go back/forward, or reload.",
        metadata: { icon: "browser" },
        inputSchema: navigateSchema,
        execute: async (args, ctx) => {
          const { id, action, url } = navigateSchema.parse(args)
          return withTab(service, ctx.sessionId, id, async (tab) => {
            if (action === "goto") await tab.navigateAndWait(url!)
            else if (action === "back") await tab.goBackAndWait()
            else if (action === "forward") await tab.goForwardAndWait()
            else await tab.reloadAndWait()
            return tabState(tab)
          })
        },
      },
      {
        name: "snapshot",
        description: "Return an accessibility tree with refs for interaction.",
        metadata: { icon: "browser" },
        inputSchema: snapshotSchema,
        execute: async (args, ctx) => {
          const { id, includeUrls, ...options } = snapshotSchema.parse(args)
          return withTab(service, ctx.sessionId, id, async (tab) =>
            spill(await tab.snapshot({ ...options, urls: includeUrls })),
          )
        },
      },
      {
        name: "read_page",
        description: "Read the current page as clean markdown.",
        metadata: { icon: "browser" },
        inputSchema: tabIdInputSchema,
        execute: async (args, ctx) => {
          const { id } = tabIdInputSchema.parse(args)
          return withTab(service, ctx.sessionId, id, async (tab) => {
            const page = await tab.read()
            return spill(page.content, { url: page.url, title: page.title })
          })
        },
      },
      {
        name: "eval_js",
        description: "Run a JavaScript function in a tab and return its value.",
        metadata: { icon: "browser" },
        inputSchema: evalSchema,
        execute: async (args, ctx) => {
          const { id, script, sessionId } = evalSchema.parse(args)
          return withTab(service, ctx.sessionId, id, async (tab) =>
            spill(JSON.stringify(await tab.evalJs(script, sessionId), null, 2)),
          )
        },
      },
      {
        name: "cdp_call",
        description:
          "Send a raw Chrome DevTools Protocol command to a tab via Electron's webContents.debugger (https://www.electronjs.org/docs/latest/api/debugger). CDP methods and params: https://chromedevtools.github.io/devtools-protocol/",
        metadata: { icon: "browser" },
        inputSchema: cdpCallSchema,
        execute: async (args, ctx) => {
          const { id, method, params, sessionId, timeout } = cdpCallSchema.parse(args)
          try {
            const tab = getTab(service, ctx.sessionId, id)
            return spill(JSON.stringify(await tab.sendCdp(method, params, sessionId, secondsToMs(timeout)), null, 2))
          } catch (error) {
            const tab = resolveService(service).tab(ctx.sessionId, id)
            return {
              error: error instanceof Error ? error.message : String(error),
              ...(tab && { tab: tabState(tab) }),
            }
          }
        },
      },
      {
        name: "cdp_events",
        description:
          "Drain buffered Chrome DevTools Protocol events from a tab. Events accumulate only after their domain is enabled via cdp_call.",
        metadata: { icon: "browser" },
        inputSchema: cdpEventsSchema,
        execute: async (args, ctx) => {
          const { id, filter } = cdpEventsSchema.parse(args)
          return withTab(service, ctx.sessionId, id, (tab) => {
            const { events, dropped } = tab.drainCdpEvents(filter)
            return spill(JSON.stringify(events, null, 2), { count: events.length, dropped })
          })
        },
      },
      {
        name: "console",
        description: "Read buffered console messages (log/warn/error) from a tab.",
        metadata: { icon: "browser" },
        inputSchema: consoleSchema,
        execute: async (args, ctx) => {
          const { id, ...options } = consoleSchema.parse(args)
          return withTab(service, ctx.sessionId, id, (tab) => {
            const { entries, dropped } = tab.readConsole(options)
            return spill(JSON.stringify(entries, null, 2), { count: entries.length, dropped })
          })
        },
      },
      {
        name: "errors",
        description: "Read uncaught JavaScript errors from a tab.",
        metadata: { icon: "browser" },
        inputSchema: errorsSchema,
        execute: async (args, ctx) => {
          const { id, clear } = errorsSchema.parse(args)
          return withTab(service, ctx.sessionId, id, (tab) => {
            const { entries, dropped } = tab.readErrors({ clear })
            return spill(JSON.stringify(entries, null, 2), { count: entries.length, dropped })
          })
        },
      },
      ...queryTools(service),
      ...interactionTools(service),
      ...waitTools(service),
      ...captureTools(service),
      ...inputTools(service),
    ],
  }
}

function queryTools(service: BrowserServiceProvider): Toolkit["tools"] {
  const queryElementSchema = z
    .object({
      id: idSchema,
      selector: elementTargetSchema,
      query: z
        .enum(["text", "html", "value", "box", "visible", "enabled", "checked", "attr", "styles"])
        .describe("What to read from the element."),
      name: z.string().min(1).optional().describe("Attribute name for attr query."),
      properties: z
        .array(z.string().min(1))
        .optional()
        .describe("Computed CSS properties for styles query."),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.query === "attr" && !value.name) {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: 'Attribute name is required when query is "attr".',
        })
      }
      if (value.query !== "attr" && value.name !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: 'Attribute name is only valid when query is "attr".',
        })
      }
      if (value.query !== "styles" && value.properties !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["properties"],
          message: 'Style properties are only valid when query is "styles".',
        })
      }
    })
  return [
    {
      name: "query_element",
      description: "Query text, value, state, attributes, styles, or geometry from one element selected by selector.",
      metadata: { icon: "browser" },
      inputSchema: queryElementSchema,
      execute: async (args, ctx) => {
        const { id, selector, query, name, properties } = queryElementSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          if (query === "text") return spill(await tab.getText(selector))
          if (query === "html") return spill(await tab.getHtml(selector))
          if (query === "value") return { value: await tab.getValue(selector) }
          if (query === "box") return tab.getBox(selector)
          if (query === "visible") return { visible: await tab.isVisible(selector) }
          if (query === "enabled") return { enabled: await tab.isEnabled(selector) }
          if (query === "checked") return { checked: await tab.isChecked(selector) }
          if (query === "attr") return { name, value: await tab.getAttr(selector, name!) }
          return spill(JSON.stringify(await tab.getStyles(selector, properties), null, 2))
        })
      },
    },
  ]
}

const elementActionSchema = z
  .enum(["dblclick", "hover", "focus", "check", "uncheck", "scroll_into_view", "highlight"])
  .describe("Action to perform on the element.")

const clickSchema = z
  .object({
    id: idSchema,
    selector: elementTargetSchema,
    newTab: z.boolean().default(false).describe("Open link target in a new tab."),
  })
  .strict()

const elementActionInputSchema = z
  .object({
    id: idSchema,
    selector: elementTargetSchema,
    action: elementActionSchema,
  })
  .strict()

const dragSchema = z
  .object({
    id: idSchema,
    source: elementTargetSchema,
    target: elementTargetSchema,
  })
  .strict()

const uploadSchema = z
  .object({
    id: idSchema,
    selector: elementTargetSchema,
    files: z.array(z.string().min(1)).min(1).describe("Local file paths to upload."),
  })
  .strict()

const downloadSchema = z
  .object({
    id: idSchema,
    selector: elementTargetSchema,
    path: z.string().min(1).describe("Local path to save the download."),
    timeout: z.number().positive().default(1800).describe("Timeout in seconds. Defaults to 1800."),
  })
  .strict()

const fillSchema = z.object({ id: idSchema, selector: elementTargetSchema, text: z.string() }).strict()

const typeSchema = z
  .object({
    id: idSchema,
    selector: elementTargetSchema,
    text: z.string(),
    clear: z.boolean().default(false).describe("Clear existing value first."),
    delay: z.number().nonnegative().optional().describe("Delay between key presses in seconds."),
  })
  .strict()

const pressSchema = z.object({ id: idSchema, key: z.string().min(1).describe("Key name or chord.") }).strict()

const selectSchema = z
  .object({
    id: idSchema,
    selector: elementTargetSchema,
    values: z.array(z.string().min(1)).min(1).describe("Option values to select."),
  })
  .strict()

const scrollSchema = z
  .object({
    id: idSchema,
    selector: elementTargetSchema.optional(),
    direction: z.enum(["up", "down", "left", "right"]).default("down"),
    amount: z.number().int().positive().default(300).describe("Pixels to scroll."),
  })
  .strict()

function interactionTools(service: BrowserServiceProvider): Toolkit["tools"] {
  return [
    {
      name: "click",
      description: "Click one element.",
      metadata: { icon: "browser" },
      inputSchema: clickSchema,
      execute: async (args, ctx) => {
        const { id, selector, newTab } = clickSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          if (newTab) {
            const href = await tab.elementHref(selector)
            if (!href) throw new Error(`element '${selector}' has no link target`)
            return {
              clicked: selector,
              newTab: true,
              id: resolveService(service).createTab(ctx.sessionId, href),
              url: href,
            }
          }
          await tab.click(selector)
          return { clicked: selector }
        })
      },
    },
    {
      name: "element_action",
      description: "Double-click, hover, focus, check, uncheck, scroll into view, or highlight one element.",
      metadata: { icon: "browser" },
      inputSchema: elementActionInputSchema,
      execute: async (args, ctx) => {
        const { id, selector, action } = elementActionInputSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          if (action === "dblclick") await tab.dblclick(selector)
          else if (action === "hover") await tab.hover(selector)
          else if (action === "focus") await tab.focus(selector)
          else if (action === "check") await tab.check(selector)
          else if (action === "uncheck") await tab.uncheck(selector)
          else if (action === "scroll_into_view") await tab.scrollIntoView(selector)
          else await tab.highlight(selector)
          return { action, selector }
        })
      },
    },
    {
      name: "drag",
      description: "Drag the source element to the target element.",
      metadata: { icon: "browser" },
      inputSchema: dragSchema,
      execute: async (args, ctx) => {
        const { id, source, target } = dragSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.drag(source, target)
          return { dragged: true, source, target }
        })
      },
    },
    {
      name: "upload",
      description: "Upload files through a file input.",
      metadata: { icon: "browser" },
      inputSchema: uploadSchema,
      execute: async (args, ctx) => {
        const { id, selector, files } = uploadSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.upload(selector, files)
          return { uploaded: files.length }
        })
      },
    },
    {
      name: "download",
      description: "Click an element and save downloads detected by Electron will-download.",
      metadata: { icon: "browser" },
      inputSchema: downloadSchema,
      execute: async (args, ctx) => {
        const { id, selector, path, timeout } = downloadSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => ({
          path: await tab.download(selector, path, secondsToMs(timeout)),
        }))
      },
    },
    {
      name: "fill",
      description: "Clear and fill an input element.",
      metadata: { icon: "browser" },
      inputSchema: fillSchema,
      execute: async (args, ctx) => {
        const { id, selector, text } = fillSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.fill(selector, text)
          return { filled: selector }
        })
      },
    },
    {
      name: "type",
      description: "Type text into an element.",
      metadata: { icon: "browser" },
      inputSchema: typeSchema,
      execute: async (args, ctx) => {
        const { id, selector, text, clear, delay } = typeSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.type(selector, text, clear, secondsToMs(delay))
          return { typed: text }
        })
      },
    },
    {
      name: "press",
      description: "Press a key at the current focus.",
      metadata: { icon: "browser" },
      inputSchema: pressSchema,
      execute: async (args, ctx) => {
        const { id, key } = pressSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.press(key)
          return { pressed: key }
        })
      },
    },
    {
      name: "select",
      description: "Select one or more options in a select element.",
      metadata: { icon: "browser" },
      inputSchema: selectSchema,
      execute: async (args, ctx) => {
        const { id, selector, values } = selectSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.select(selector, values)
          return { selected: values }
        })
      },
    },
    {
      name: "scroll",
      description: "Scroll the page or an element.",
      metadata: { icon: "browser" },
      inputSchema: scrollSchema,
      execute: async (args, ctx) => {
        const { id, selector, direction, amount } = scrollSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.scroll(selector, direction, amount)
          return { scrolled: true }
        })
      },
    },
  ]
}

function waitTools(service: BrowserServiceProvider): Toolkit["tools"] {
  const waitForSchema = z
    .object({
      id: idSchema,
      selector: cssSelectorSchema,
      state: z
        .enum(["visible", "attached", "detached", "hidden"])
        .default("visible")
        .describe("Element state. Defaults to visible."),
      timeout: timeoutSchema,
    })
    .strict()

  return [
    {
      name: "wait_for",
      description: "Wait for an element state.",
      metadata: { icon: "browser" },
      inputSchema: waitForSchema,
      execute: async (args, ctx) => {
        const input = waitForSchema.parse(args)
        return withTab(service, ctx.sessionId, input.id, async (tab) => {
          await tab.waitForSelector(input.selector, input.state, secondsToMs(input.timeout))
          return { selector: input.selector, state: input.state }
        })
      },
    },
  ]
}

const screenshotSchema = z
  .object({
    id: idSchema,
    selector: elementTargetSchema.optional().describe("Element to capture; omit for the viewport."),
    fullPage: z.boolean().default(false).describe("Capture the full scrollable page."),
    format: z.enum(["png", "jpeg"]).default("png"),
    quality: z.number().int().min(0).max(100).optional().describe("JPEG quality."),
    path: z.string().optional().describe("Local file path; omit to save to a temp file."),
  })
  .strict()

const pdfSchema = z
  .object({
    id: idSchema,
    path: z.string().optional().describe("Local PDF path; omit to save to a temp file."),
  })
  .strict()

const recordSchema = z
  .object({
    id: idSchema,
    path: z.string().min(1).describe("Local .webm file path."),
  })
  .strict()

function captureTools(service: BrowserServiceProvider): Toolkit["tools"] {
  return [
    {
      name: "screenshot",
      description: "Capture a screenshot of the page or an element.",
      metadata: { icon: "browser" },
      inputSchema: screenshotSchema,
      execute: async (args, ctx) => {
        const { id, path, ...opts } = screenshotSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          const result = await tab.screenshot(opts)
          return await writeDataUrl(path ?? tempPath(opts.format), result.data, result.mimeType)
        })
      },
    },
    {
      name: "pdf",
      description: "Save the current page as a PDF.",
      metadata: { icon: "browser" },
      inputSchema: pdfSchema,
      execute: async (args, ctx) => {
        const { id, path } = pdfSchema.parse(args)
        const target = path ?? tempPath("pdf")
        return withTab(service, ctx.sessionId, id, async (tab) => writeBytes(target, await tab.pdf()))
      },
    },
    {
      name: "record_start",
      description: "Start recording a tab to a webm video file.",
      metadata: { icon: "browser" },
      inputSchema: recordSchema,
      execute: async (args, ctx) => {
        const { id, path } = recordSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await resolveService(service).recordStart(ctx.sessionId, tab, path)
          return { recording: true, path }
        })
      },
    },
    {
      name: "record_stop",
      description: "Stop the current recording and save the video.",
      metadata: { icon: "browser" },
      inputSchema: z.object({}).strict(),
      execute: async (_args, ctx) => {
        try {
          const { path, data } = await resolveService(service).recordStop(ctx.sessionId)
          return await writeBytes(path, data)
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    {
      name: "record_restart",
      description: "Stop any current recording and start a fresh one for the tab.",
      metadata: { icon: "browser" },
      inputSchema: recordSchema,
      execute: async (args, ctx) => {
        const { id, path } = recordSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await resolveService(service).recordRestart(ctx.sessionId, tab, path)
          return { recording: true, path }
        })
      },
    },
  ]
}

const keyboardActionSchema = z
  .object({
    id: idSchema,
    action: z.enum(["down", "up"]).describe("Keyboard action."),
    key: z.string().min(1).describe("KeyboardEvent.key name or modifier chord."),
  })
  .strict()

const keyboardTextSchema = z
  .object({
    id: idSchema,
    text: z.string().describe("Text input."),
  })
  .strict()

const mouseMoveSchema = z
  .object({
    id: idSchema,
    x: z.number().describe("Viewport x coordinate, usually from query_element box."),
    y: z.number().describe("Viewport y coordinate, usually from query_element box."),
  })
  .strict()

const mouseButtonSchema = z
  .object({
    id: idSchema,
    action: z.enum(["down", "up"]).describe("Mouse button action."),
    button: z.enum(["left", "right", "middle"]).default("left"),
  })
  .strict()

const mouseWheelSchema = z
  .object({
    id: idSchema,
    dy: z.number().describe("Vertical scroll delta; positive scrolls down."),
    dx: z.number().default(0).describe("Horizontal scroll delta; positive scrolls right."),
  })
  .strict()

function inputTools(service: BrowserServiceProvider): Toolkit["tools"] {
  return [
    {
      name: "keyboard_key",
      description: "Press or release a key.",
      metadata: { icon: "browser" },
      inputSchema: keyboardActionSchema,
      execute: async (args, ctx) => {
        const { id, action, key } = keyboardActionSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          if (action === "down") await tab.keyDown(key)
          else await tab.keyUp(key)
          return { action, key }
        })
      },
    },
    {
      name: "keyboard_type",
      description: "Type text at the current focus using real key events.",
      metadata: { icon: "browser" },
      inputSchema: keyboardTextSchema,
      execute: async (args, ctx) => {
        const { id, text } = keyboardTextSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.keyboardType(text)
          return { typed: text }
        })
      },
    },
    {
      name: "keyboard_insert_text",
      description: "Insert text at the current focus without key events.",
      metadata: { icon: "browser" },
      inputSchema: keyboardTextSchema,
      execute: async (args, ctx) => {
        const { id, text } = keyboardTextSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.keyboardInsertText(text)
          return { inserted: text }
        })
      },
    },
    {
      name: "mouse_move",
      description: "Move the mouse.",
      metadata: { icon: "browser" },
      inputSchema: mouseMoveSchema,
      execute: async (args, ctx) => {
        const { id, x, y } = mouseMoveSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.mouseMove(x, y)
          return { x, y }
        })
      },
    },
    {
      name: "mouse_button",
      description: "Press or release a mouse button.",
      metadata: { icon: "browser" },
      inputSchema: mouseButtonSchema,
      execute: async (args, ctx) => {
        const { id, action, button } = mouseButtonSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          if (action === "down") await tab.mouseDown(button)
          else await tab.mouseUp(button)
          return { action, button }
        })
      },
    },
    {
      name: "mouse_wheel",
      description: "Scroll with the mouse wheel.",
      metadata: { icon: "browser" },
      inputSchema: mouseWheelSchema,
      execute: async (args, ctx) => {
        const { id, dx, dy } = mouseWheelSchema.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.mouseWheel(dx, dy)
          return { dx, dy }
        })
      },
    },
  ]
}
