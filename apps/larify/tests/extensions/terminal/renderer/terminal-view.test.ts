// @vitest-environment jsdom

import { createElement, type ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setAgentSessionId } from "../../../../src/renderer/src/lib/agent-session"

const fitMocks: Array<ReturnType<typeof vi.fn>> = []
const terminalMocks: Array<{
  dispose: ReturnType<typeof vi.fn>
  onResize: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
}> = []

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}))

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn()

    constructor() {
      fitMocks.push(this.fit)
    }
  },
}))

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: class {},
}))

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80
    rows = 24
    unicode = { activeVersion: "" }
    options = {}
    loadAddon = vi.fn()
    open = vi.fn()
    write = vi.fn((_data: string, callback?: () => void) => callback?.())
    focus = vi.fn()
    dispose = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    onData = vi.fn()
    onResize = vi.fn()
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols
      this.rows = rows
    })

    constructor() {
      terminalMocks.push({
        dispose: this.dispose,
        onResize: this.onResize,
        resize: this.resize,
        write: this.write,
      })
    }
  },
}))

vi.mock("@renderer/components/workbench", () => ({
  WorkbenchTabsLayout: ({ children, tabs }: { children: ReactNode; tabs: Array<{ title: string }> }) =>
    createElement(
      "div",
      { "data-testid": "terminal-layout" },
      createElement("div", { "data-testid": "tabs" }, tabs.map((tab) => tab.title).join(",")),
      children,
    ),
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("TerminalView", () => {
  let container: HTMLDivElement
  let root: Root
  let stateRequests: Record<string, Deferred<unknown>>
  let listeners: Record<string, (payload: unknown) => void>

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    fitMocks.length = 0
    terminalMocks.length = 0
    stateRequests = {}
    listeners = {}
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe = vi.fn()
        disconnect = vi.fn()
      },
    })
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
    })
    Object.defineProperty(window, "bridge", {
      configurable: true,
      value: {
        invoke: vi.fn((channel: string, sessionId: string) => {
          if (channel === "terminal:getState") {
            stateRequests[sessionId] = deferred()
            return stateRequests[sessionId].promise
          }
          if (channel === "terminal:create") return Promise.resolve(1)
          if (channel === "terminal:snapshot") return Promise.resolve({ data: "snapshot", cols: 80, rows: 24 })
          return Promise.resolve()
        }),
        on: vi.fn((channel: string, callback: (payload: unknown) => void) => {
          listeners[channel] = callback
          return () => {
            delete listeners[channel]
          }
        }),
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("does not let an old session getState response overwrite the current session", async () => {
    const { TerminalView } = await import("../../../../src/extensions/terminal/renderer/terminal-view")

    setAgentSessionId("session-a")
    await act(async () => {
      root.render(createElement(TerminalView))
    })

    await act(async () => {
      setAgentSessionId("session-b")
    })

    await act(async () => {
      stateRequests["session-b"].resolve({
        sessionId: "session-b",
        activeId: 2,
        terminals: [{ id: 2, pid: 20, title: "B", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    expect(container.querySelector('[data-testid="tabs"]')?.textContent).toBe("B")

    await act(async () => {
      stateRequests["session-a"].resolve({
        sessionId: "session-a",
        activeId: 1,
        terminals: [{ id: 1, pid: 10, title: "A", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    expect(container.querySelector('[data-testid="tabs"]')?.textContent).toBe("B")
  })

  it("keeps terminal entries mounted when switching sessions", async () => {
    const { TerminalView } = await import("../../../../src/extensions/terminal/renderer/terminal-view")

    setAgentSessionId("session-a")
    await act(async () => {
      root.render(createElement(TerminalView))
    })

    await act(async () => {
      stateRequests["session-a"].resolve({
        sessionId: "session-a",
        activeId: 1,
        terminals: [{ id: 1, pid: 10, title: "A", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    const firstTerminal = terminalMocks[0]

    await act(async () => {
      setAgentSessionId("session-b")
    })

    await act(async () => {
      stateRequests["session-b"].resolve({
        sessionId: "session-b",
        activeId: 1,
        terminals: [{ id: 1, pid: 20, title: "B", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    await act(async () => {
      setAgentSessionId("session-a")
    })

    await act(async () => {
      stateRequests["session-a"].resolve({
        sessionId: "session-a",
        activeId: 1,
        terminals: [{ id: 1, pid: 10, title: "A", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    expect(firstTerminal.dispose).not.toHaveBeenCalled()
    expect(terminalMocks).toHaveLength(2)
    expect(container.querySelector('[data-testid="tabs"]')?.textContent).toBe("A")
  })

  it("disposes stale entries when the loaded terminal state is empty", async () => {
    const { TerminalView } = await import("../../../../src/extensions/terminal/renderer/terminal-view")

    setAgentSessionId("session-empty")
    await act(async () => {
      root.render(createElement(TerminalView))
    })

    await act(async () => {
      stateRequests["session-empty"].resolve({
        sessionId: "session-empty",
        activeId: 1,
        terminals: [{ id: 1, pid: 10, title: "A", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    const firstTerminal = terminalMocks[0]

    await act(async () => {
      listeners["terminal:state"]?.({
        sessionId: "session-empty",
        activeId: null,
        terminals: [],
      })
    })

    expect(firstTerminal.dispose).toHaveBeenCalledTimes(1)
    expect(window.bridge.invoke).not.toHaveBeenCalledWith("terminal:create", "session-empty")
  })

  it("fits terminals when the workbench is small", async () => {
    const { TerminalView } = await import("../../../../src/extensions/terminal/renderer/terminal-view")

    setAgentSessionId("session-small")
    await act(async () => {
      root.render(createElement(TerminalView))
    })

    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 10, height: 10, left: 0, right: 10, top: 0, width: 10 }),
    })

    await act(async () => {
      stateRequests["session-small"].resolve({
        sessionId: "session-small",
        activeId: 1,
        terminals: [{ id: 1, pid: 10, title: "A", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    expect(fitMocks.some((fit) => fit.mock.calls.length > 0)).toBe(true)
  })

  it("does not request a snapshot for a newly mounted terminal entry", async () => {
    const { TerminalView } = await import("../../../../src/extensions/terminal/renderer/terminal-view")

    setAgentSessionId("session-live")
    await act(async () => {
      root.render(createElement(TerminalView))
    })

    await act(async () => {
      stateRequests["session-live"].resolve({
        sessionId: "session-live",
        activeId: 1,
        terminals: [{ id: 1, pid: 10, title: "A", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    await act(async () => {
      listeners["terminal:data"]?.({
        sessionId: "session-live",
        terminalId: 1,
        data: "live",
      })
    })

    expect(window.bridge.invoke).not.toHaveBeenCalledWith("terminal:snapshot", "session-live", 1)
    expect(window.bridge.invoke).not.toHaveBeenCalledWith("terminal:attach", "session-live", 1)
    expect(terminalMocks[0].write.mock.calls.map((call) => call[0])).toEqual(["live"])
  })

  it("debounces backend resize and sends the latest dimensions", async () => {
    const { TerminalView } = await import("../../../../src/extensions/terminal/renderer/terminal-view")

    setAgentSessionId("session-resize")
    await act(async () => {
      root.render(createElement(TerminalView))
    })

    await act(async () => {
      stateRequests["session-resize"].resolve({
        sessionId: "session-resize",
        activeId: 1,
        terminals: [{ id: 1, pid: 10, title: "A", cwd: "/", shell: "sh", exitCode: null }],
      })
    })

    const resizeHandler = terminalMocks[0].onResize.mock.calls[0][0] as (size: {
      cols: number
      rows: number
    }) => void

    await act(async () => {
      resizeHandler({ cols: 12, rows: 3 })
      resizeHandler({ cols: 20, rows: 8 })
    })

    expect(window.bridge.invoke).not.toHaveBeenCalledWith(
      "terminal:resize",
      "session-resize",
      1,
      12,
      3,
    )

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 110))
    })

    expect(window.bridge.invoke).toHaveBeenCalledWith("terminal:resize", "session-resize", 1, 20, 8)
  })
})
