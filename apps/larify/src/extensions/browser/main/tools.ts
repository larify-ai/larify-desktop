import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Toolkit } from "../../../shared/tool"
import { larifyTempPath } from "../../../main/utils/app-paths"
import { prepareToolOutput } from "../../../main/utils/tool-output"
import type { BrowserService } from "./browser-service"
import type { BrowserTab } from "./tab"
import * as waits from "./waits"

const idSchema = z.number().int().positive().describe("Browser tab id")
const elementTargetSchema = z
  .string()
  .min(1)
  .describe("CSS selector, xpath=... expression, or snapshot ref")
const cssOrXpathSchema = z.string().min(1).describe("CSS selector or xpath=... expression")
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
    url: z.string().min(1).describe("URL or local file path"),
  })
  .strict()

const tabIdInputSchema = z.object({ id: idSchema }).strict()

const snapshotSchema = z
  .object({
    id: idSchema,
    interactive: z.boolean().default(false),
    includeUrls: z.boolean().optional(),
    compact: z.boolean().optional(),
    depth: z.number().int().positive().optional(),
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
          "Open a new browser tab, optionally navigating to a URL or local file path. Returns the new tab state.",
        metadata: { icon: "browser" },
        inputSchema: z.object({ url: z.string().optional().describe("URL or local file path") }).strict(),
        execute: async (args, ctx) => {
          const { url } = z.object({ url: z.string().optional() }).strict().parse(args)
          try {
            const resolved = resolveService(service)
            const id = resolved.createTab(ctx.sessionId, url)
            return tabState(getTab(service, ctx.sessionId, id))
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
        description:
          "Navigate a tab to a URL or local file path. Waits until the page finishes loading, then returns the tab state.",
        metadata: { icon: "browser" },
        inputSchema: navigateSchema,
        execute: async (args, ctx) => {
          const { id, url } = navigateSchema.parse(args)
          return withTab(service, ctx.sessionId, id, async (tab) => {
            await tab.navigateAndWait(url)
            return tabState(tab)
          })
        },
      },
      navigationTool(
        service,
        "back",
        "Go back one entry in the tab history. Does nothing if there is no previous entry. Returns the tab state after the page settles.",
        (tab) => tab.goBackAndWait(),
      ),
      navigationTool(
        service,
        "forward",
        "Go forward one entry in the tab history. Does nothing if there is no next entry. Returns the tab state after the page settles.",
        (tab) => tab.goForwardAndWait(),
      ),
      navigationTool(
        service,
        "reload",
        "Reload a tab. Waits until the page finishes loading, then returns the tab state.",
        (tab) => tab.reloadAndWait(),
      ),
      {
        name: "snapshot",
        description: "Return an accessibility-tree snapshot with stable element refs.",
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
        description: "Read a page's main content as clean markdown.",
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

function navigationTool(
  service: BrowserServiceProvider,
  name: "back" | "forward" | "reload",
  description: string,
  action: (tab: BrowserTab) => Promise<void>,
): Toolkit["tools"][number] {
  return {
    name,
    description,
    metadata: { icon: "browser" },
    inputSchema: tabIdInputSchema,
    execute: async (args, ctx) => {
      const { id } = tabIdInputSchema.parse(args)
      return withTab(service, ctx.sessionId, id, async (tab) => {
        await action(tab)
        return tabState(tab)
      })
    },
  }
}

function queryTools(service: BrowserServiceProvider): Toolkit["tools"] {
  const oneSelector = z.object({ id: idSchema, selector: elementTargetSchema }).strict()
  return [
    {
      name: "get_text",
      description: "Get the visible text of an element.",
      metadata: { icon: "browser" },
      inputSchema: oneSelector,
      execute: async (args, ctx) => {
        const { id, selector } = oneSelector.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => spill(await tab.getText(selector)))
      },
    },
    {
      name: "get_html",
      description: "Get the innerHTML of an element.",
      metadata: { icon: "browser" },
      inputSchema: oneSelector,
      execute: async (args, ctx) => {
        const { id, selector } = oneSelector.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => spill(await tab.getHtml(selector)))
      },
    },
    {
      name: "get_value",
      description: "Get an input value.",
      metadata: { icon: "browser" },
      inputSchema: oneSelector,
      execute: async (args, ctx) => {
        const { id, selector } = oneSelector.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => ({ value: await tab.getValue(selector) }))
      },
    },
    {
      name: "get_box",
      description: "Get an element bounding box.",
      metadata: { icon: "browser" },
      inputSchema: oneSelector,
      execute: async (args: unknown, ctx) => {
        const { id, selector } = oneSelector.parse(args)
        return withTab(service, ctx.sessionId, id, (tab) => tab.getBox(selector))
      },
    },
    {
      name: "is_visible",
      description: "Check whether an element is visible.",
      metadata: { icon: "browser" },
      inputSchema: oneSelector,
      execute: async (args: unknown, ctx) => {
        const { id, selector } = oneSelector.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => ({ visible: await tab.isVisible(selector) }))
      },
    },
    {
      name: "is_enabled",
      description: "Check whether an element is enabled.",
      metadata: { icon: "browser" },
      inputSchema: oneSelector,
      execute: async (args: unknown, ctx) => {
        const { id, selector } = oneSelector.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => ({ enabled: await tab.isEnabled(selector) }))
      },
    },
    {
      name: "is_checked",
      description: "Check whether an element is checked.",
      metadata: { icon: "browser" },
      inputSchema: oneSelector,
      execute: async (args: unknown, ctx) => {
        const { id, selector } = oneSelector.parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => ({ checked: await tab.isChecked(selector) }))
      },
    },
    {
      name: "get_count",
      description: "Count matching elements.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, selector: cssOrXpathSchema }).strict(),
      execute: async (args, ctx) => {
        const { id, selector } = z.object({ id: idSchema, selector: cssOrXpathSchema }).strict().parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => ({ count: await tab.getCount(selector) }))
      },
    },
    {
      name: "get_attr",
      description: "Get an element attribute (null if absent).",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, selector: elementTargetSchema, name: z.string().min(1) }).strict(),
      execute: async (args, ctx) => {
        const { id, selector, name } = z
          .object({ id: idSchema, selector: elementTargetSchema, name: z.string().min(1) })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => ({
          name,
          value: await tab.getAttr(selector, name),
        }))
      },
    },
    {
      name: "get_styles",
      description: "Get computed styles for an element. Pass `properties` to return just those; omit for all (large).",
      metadata: { icon: "browser" },
      inputSchema: z
        .object({ id: idSchema, selector: elementTargetSchema, properties: z.array(z.string()).optional() })
        .strict(),
      execute: async (args, ctx) => {
        const { id, selector, properties } = z
          .object({ id: idSchema, selector: elementTargetSchema, properties: z.array(z.string()).optional() })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) =>
          spill(JSON.stringify(await tab.getStyles(selector, properties), null, 2)),
        )
      },
    },
  ]
}

function interactionTools(service: BrowserServiceProvider): Toolkit["tools"] {
  return [
    {
      name: "click",
      description: "Click an element by selector or snapshot ref.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, selector: elementTargetSchema, newTab: z.boolean().default(false) }).strict(),
      execute: async (args, ctx) => {
        const { id, selector, newTab } = z
          .object({ id: idSchema, selector: elementTargetSchema, newTab: z.boolean().default(false) })
          .strict()
          .parse(args)
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
    simpleSelectorAction(service, "dblclick", "Double-click an element.", "clicked", (tab, selector) =>
      tab.dblclick(selector),
    ),
    simpleSelectorAction(service, "hover", "Hover an element.", "hovered", (tab, selector) => tab.hover(selector)),
    simpleSelectorAction(service, "focus", "Focus an element.", "focused", (tab, selector) => tab.focus(selector)),
    simpleSelectorAction(service, "check", "Check a checkbox or switch.", "checked", (tab, selector) =>
      tab.check(selector),
    ),
    simpleSelectorAction(service, "uncheck", "Uncheck a checkbox or switch.", "unchecked", (tab, selector) =>
      tab.uncheck(selector),
    ),
    simpleSelectorAction(service, "scroll_into_view", "Scroll an element into view.", "scrolled", (tab, selector) =>
      tab.scrollIntoView(selector),
    ),
    simpleSelectorAction(service, "highlight", "Highlight an element.", "highlighted", (tab, selector) =>
      tab.highlight(selector),
    ),
    {
      name: "drag",
      description: "Drag one element to another.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, source: elementTargetSchema, target: elementTargetSchema }).strict(),
      execute: async (args, ctx) => {
        const { id, source, target } = z
          .object({ id: idSchema, source: elementTargetSchema, target: elementTargetSchema })
          .strict()
          .parse(args)
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
      inputSchema: z.object({ id: idSchema, selector: elementTargetSchema, files: z.array(z.string()).min(1) }).strict(),
      execute: async (args, ctx) => {
        const { id, selector, files } = z
          .object({ id: idSchema, selector: elementTargetSchema, files: z.array(z.string()).min(1) })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.upload(selector, files)
          return { uploaded: files.length }
        })
      },
    },
    {
      name: "download",
      description: "Click an element and save the download.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, selector: elementTargetSchema, path: z.string() }).strict(),
      execute: async (args, ctx) => {
        const { id, selector, path } = z
          .object({ id: idSchema, selector: elementTargetSchema, path: z.string() })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => ({
          path: await tab.download(selector, path),
        }))
      },
    },
    {
      name: "fill",
      description: "Clear and fill an input by selector or snapshot ref.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, selector: elementTargetSchema, text: z.string() }).strict(),
      execute: async (args, ctx) => {
        const { id, selector, text } = z.object({ id: idSchema, selector: elementTargetSchema, text: z.string() }).strict().parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.fill(selector, text)
          return { filled: selector }
        })
      },
    },
    {
      name: "type",
      description: "Type text into an element by selector or snapshot ref.",
      metadata: { icon: "browser" },
      inputSchema: z
        .object({
          id: idSchema,
          selector: elementTargetSchema,
          text: z.string(),
          clear: z.boolean().default(false),
          delayMs: z.number().int().nonnegative().optional(),
        })
        .strict(),
      execute: async (args, ctx) => {
        const { id, selector, text, clear, delayMs } = z
          .object({
            id: idSchema,
            selector: elementTargetSchema,
            text: z.string(),
            clear: z.boolean().default(false),
            delayMs: z.number().int().nonnegative().optional(),
          })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.type(selector, text, clear, delayMs)
          return { typed: text }
        })
      },
    },
    {
      name: "press",
      description: "Press a key at the current focus.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, key: z.string().min(1) }).strict(),
      execute: async (args, ctx) => {
        const { id, key } = z.object({ id: idSchema, key: z.string().min(1) }).strict().parse(args)
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
      inputSchema: z.object({ id: idSchema, selector: elementTargetSchema, values: z.array(z.string()).min(1) }).strict(),
      execute: async (args, ctx) => {
        const { id, selector, values } = z
          .object({ id: idSchema, selector: elementTargetSchema, values: z.array(z.string()).min(1) })
          .strict()
          .parse(args)
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
      inputSchema: z
        .object({
          id: idSchema,
          selector: elementTargetSchema.optional(),
          direction: z.enum(["up", "down", "left", "right"]).default("down"),
          amount: z.number().int().positive().default(300),
        })
        .strict(),
      execute: async (args, ctx) => {
        const { id, selector, direction, amount } = z
          .object({
            id: idSchema,
            selector: elementTargetSchema.optional(),
            direction: z.enum(["up", "down", "left", "right"]).default("down"),
            amount: z.number().int().positive().default(300),
          })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.scroll(selector, direction, amount)
          return { scrolled: true }
        })
      },
    },
  ]
}

function simpleSelectorAction(
  service: BrowserServiceProvider,
  name: string,
  description: string,
  resultKey: string,
  action: (tab: BrowserTab, selector: string) => Promise<void>,
): Toolkit["tools"][number] {
  const schema = z.object({ id: idSchema, selector: elementTargetSchema }).strict()
  return {
    name,
    description,
    metadata: { icon: "browser" },
    inputSchema: schema,
    execute: async (args, ctx) => {
      const { id, selector } = schema.parse(args)
      return withTab(service, ctx.sessionId, id, async (tab) => {
        await action(tab, selector)
        return { [resultKey]: selector }
      })
    },
  }
}

function waitTools(service: BrowserServiceProvider): Toolkit["tools"] {
  return [
    {
      name: "wait_for_selector",
      description: "Wait for an element to reach a state (visible/attached/detached/hidden).",
      metadata: { icon: "browser" },
      inputSchema: z
        .object({
          id: idSchema,
          selector: cssSelectorSchema,
          state: z.enum(["visible", "attached", "detached", "hidden"]).default("visible"),
          timeout: timeoutSchema,
        })
        .strict(),
      execute: async (args, ctx) => {
        const { id, selector, state, timeout } = z
          .object({
            id: idSchema,
            selector: cssSelectorSchema,
            state: z.enum(["visible", "attached", "detached", "hidden"]).default("visible"),
            timeout: timeoutSchema,
          })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.waitForSelector(selector, state, secondsToMs(timeout))
          return { selector, state }
        })
      },
    },
    {
      name: "wait_for_text",
      description: "Wait for text to appear on the page.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, text: z.string(), timeout: timeoutSchema }).strict(),
      execute: async (args, ctx) => {
        const { id, text, timeout } = z.object({ id: idSchema, text: z.string(), timeout: timeoutSchema }).strict().parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.waitForText(text, secondsToMs(timeout))
          return { text }
        })
      },
    },
    {
      name: "wait_for_function",
      description: "Wait for a JS expression to become truthy.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, expression: z.string(), timeout: timeoutSchema }).strict(),
      execute: async (args, ctx) => {
        const { id, expression, timeout } = z
          .object({ id: idSchema, expression: z.string(), timeout: timeoutSchema })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.waitForFunction(expression, secondsToMs(timeout))
          return { expression }
        })
      },
    },
    {
      name: "wait_for_url",
      description: "Wait for the URL to match a glob pattern (e.g. **/dashboard).",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, url: z.string(), timeout: timeoutSchema }).strict(),
      execute: async (args, ctx) => {
        const { id, url, timeout } = z.object({ id: idSchema, url: z.string(), timeout: timeoutSchema }).strict().parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.waitForUrl(url, secondsToMs(timeout))
          return { url }
        })
      },
    },
    {
      name: "wait",
      description: "Wait for a fixed number of seconds.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ seconds: z.number().nonnegative() }).strict(),
      execute: async (args) => {
        const { seconds } = z.object({ seconds: z.number().nonnegative() }).strict().parse(args)
        await waits.waitMs(seconds * 1000)
        return { waited: seconds }
      },
    },
    {
      name: "wait_for_load",
      description: "Wait for a page load state (load/domcontentloaded/networkidle).",
      metadata: { icon: "browser" },
      inputSchema: z
        .object({
          id: idSchema,
          state: z.enum(["load", "domcontentloaded", "networkidle"]).default("load"),
          timeout: timeoutSchema,
        })
        .strict(),
      execute: async (args, ctx) => {
        const { id, state, timeout } = z
          .object({
            id: idSchema,
            state: z.enum(["load", "domcontentloaded", "networkidle"]).default("load"),
            timeout: timeoutSchema,
          })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.waitForLoad(state, secondsToMs(timeout))
          return { state }
        })
      },
    },
    {
      name: "wait_for_download",
      description: "Wait for a download to finish, saving it to the given path.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, path: z.string(), timeout: timeoutSchema }).strict(),
      execute: async (args, ctx) => {
        const { id, path, timeout } = z
          .object({ id: idSchema, path: z.string(), timeout: timeoutSchema })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, (tab) => tab.waitForDownload(path, secondsToMs(timeout)))
      },
    },
  ]
}

function captureTools(service: BrowserServiceProvider): Toolkit["tools"] {
  return [
    {
      name: "screenshot",
      description: "Capture a screenshot of the page or an element.",
      metadata: { icon: "browser" },
      inputSchema: z
        .object({
          id: idSchema,
          selector: elementTargetSchema.optional(),
          fullPage: z.boolean().default(false),
          format: z.enum(["png", "jpeg"]).default("png"),
          quality: z.number().int().min(0).max(100).optional(),
          path: z.string().optional(),
        })
        .strict(),
      execute: async (args, ctx) => {
        const { id, path, ...opts } = z
          .object({
            id: idSchema,
            selector: elementTargetSchema.optional(),
            fullPage: z.boolean().default(false),
            format: z.enum(["png", "jpeg"]).default("png"),
            quality: z.number().int().min(0).max(100).optional(),
            path: z.string().optional(),
          })
          .strict()
          .parse(args)
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
      inputSchema: z.object({ id: idSchema, path: z.string().optional() }).strict(),
      execute: async (args, ctx) => {
        const { id, path } = z.object({ id: idSchema, path: z.string().optional() }).strict().parse(args)
        const target = path ?? tempPath("pdf")
        return withTab(service, ctx.sessionId, id, async (tab) => writeBytes(target, await tab.pdf()))
      },
    },
    {
      name: "record_start",
      description: "Start recording a tab to a webm video file.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, path: z.string() }).strict(),
      execute: async (args, ctx) => {
        const { id, path } = z.object({ id: idSchema, path: z.string() }).strict().parse(args)
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
      inputSchema: z.object({ id: idSchema, path: z.string() }).strict(),
      execute: async (args, ctx) => {
        const { id, path } = z.object({ id: idSchema, path: z.string() }).strict().parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await resolveService(service).recordRestart(ctx.sessionId, tab, path)
          return { recording: true, path }
        })
      },
    },
  ]
}

function inputTools(service: BrowserServiceProvider): Toolkit["tools"] {
  return [
    keyTool(service, "keydown", "Press and hold a key.", "down", (tab, key) => tab.keyDown(key)),
    keyTool(service, "keyup", "Release a key.", "up", (tab, key) => tab.keyUp(key)),
    {
      name: "keyboard_type",
      description: "Type text at the current focus using real key events.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, text: z.string() }).strict(),
      execute: async (args, ctx) => {
        const { id, text } = z.object({ id: idSchema, text: z.string() }).strict().parse(args)
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
      inputSchema: z.object({ id: idSchema, text: z.string() }).strict(),
      execute: async (args, ctx) => {
        const { id, text } = z.object({ id: idSchema, text: z.string() }).strict().parse(args)
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
      inputSchema: z
        .object({
          id: idSchema,
          x: z.number().describe("Viewport x coordinate, usually from get_box."),
          y: z.number().describe("Viewport y coordinate, usually from get_box."),
        })
        .strict(),
      execute: async (args, ctx) => {
        const { id, x, y } = z
          .object({
            id: idSchema,
            x: z.number().describe("Viewport x coordinate, usually from get_box."),
            y: z.number().describe("Viewport y coordinate, usually from get_box."),
          })
          .strict()
          .parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.mouseMove(x, y)
          return { x, y }
        })
      },
    },
    mouseButtonTool(service, "mouse_down", "Press a mouse button.", "down", (tab, button) => tab.mouseDown(button)),
    mouseButtonTool(service, "mouse_up", "Release a mouse button.", "up", (tab, button) => tab.mouseUp(button)),
    {
      name: "mouse_wheel",
      description: "Scroll with the mouse wheel.",
      metadata: { icon: "browser" },
      inputSchema: z.object({ id: idSchema, dx: z.number().default(0), dy: z.number() }).strict(),
      execute: async (args, ctx) => {
        const { id, dx, dy } = z.object({ id: idSchema, dx: z.number().default(0), dy: z.number() }).strict().parse(args)
        return withTab(service, ctx.sessionId, id, async (tab) => {
          await tab.mouseWheel(dx, dy)
          return { dx, dy }
        })
      },
    },
  ]
}

function keyTool(
  service: BrowserServiceProvider,
  name: string,
  description: string,
  resultKey: "down" | "up",
  action: (tab: BrowserTab, key: string) => Promise<void>,
): Toolkit["tools"][number] {
  const schema = z.object({ id: idSchema, key: z.string().min(1) }).strict()
  return {
    name,
    description,
    metadata: { icon: "browser" },
    inputSchema: schema,
    execute: async (args, ctx) => {
      const { id, key } = schema.parse(args)
      return withTab(service, ctx.sessionId, id, async (tab) => {
        await action(tab, key)
        return { [resultKey]: key }
      })
    },
  }
}

function mouseButtonTool(
  service: BrowserServiceProvider,
  name: string,
  description: string,
  resultKey: "down" | "up",
  action: (tab: BrowserTab, button: "left" | "right" | "middle") => Promise<void>,
): Toolkit["tools"][number] {
  const schema = z
    .object({ id: idSchema, button: z.enum(["left", "right", "middle"]).default("left") })
    .strict()
  return {
    name,
    description,
    metadata: { icon: "browser" },
    inputSchema: schema,
    execute: async (args, ctx) => {
      const { id, button } = schema.parse(args)
      return withTab(service, ctx.sessionId, id, async (tab) => {
        await action(tab, button)
        return { [resultKey]: button }
      })
    },
  }
}
