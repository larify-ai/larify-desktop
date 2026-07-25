import { useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { FitAddon } from "@xterm/addon-fit"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { Terminal as XTerm, type ITheme } from "@xterm/xterm"
import { SquareTerminalIcon } from "lucide-react"
import { WorkbenchTabsLayout, type WorkbenchTab } from "@renderer/components/workbench"
import { useAgentSessionCwd, useAgentSessionId } from "@renderer/lib/agent-session"
import type {
  SessionTerminalsState,
  TerminalDataEvent,
  TerminalExitEvent,
} from "../shared/types"
import "@xterm/xterm/css/xterm.css"
import "./terminal-view.css"

const TERMINAL_ICON = <SquareTerminalIcon aria-hidden="true" />

const RESIZE_DEBOUNCE_MS = 100

const EMPTY_STATE = (sessionId: string): SessionTerminalsState => ({
  sessionId,
  terminals: [],
  activeId: null,
})

const readCssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const terminalTheme = (): ITheme => ({
  background: readCssVar("--background"),
  brightYellow: readCssVar("--foreground"),
  foreground: readCssVar("--foreground"),
  cursor: readCssVar("--foreground"),
  selectionBackground: readCssVar("--primary"),
  selectionForeground: readCssVar("--primary-foreground"),
  selectionInactiveBackground: readCssVar("--muted-foreground"),
  yellow: readCssVar("--foreground"),
})

const terminalFontFamily = (): string => readCssVar("--font-mono")

interface TerminalEntry {
  term: XTerm
  fit: FitAddon
  host: HTMLDivElement
  exited: boolean
  restoring: boolean
  lastSeq: number
  pendingData: TerminalDataEvent[]
  pendingResize: { cols: number; rows: number } | null
  resizeTimer: ReturnType<typeof setTimeout> | null
  lastSentCols: number | null
  lastSentRows: number | null
  suppressResize: boolean
}

const asState = (value: unknown, sessionId: string): SessionTerminalsState => {
  if (!value || typeof value !== "object") return EMPTY_STATE(sessionId)
  return value as SessionTerminalsState
}

const copySelection = (term: XTerm): boolean => {
  const selection = term.getSelection()
  if (!selection) return false
  void navigator.clipboard?.writeText(selection)
  term.clearSelection()
  return true
}

const pasteClipboard = (term: XTerm): void => {
  void navigator.clipboard
    ?.readText()
    .then((text) => {
      if (text) term.paste(text)
    })
    .catch((error) => console.error("[terminal:paste]", error))
}

const applyData = (entry: TerminalEntry, event: TerminalDataEvent): void => {
  if (event.end <= entry.lastSeq) return
  const data =
    event.start < entry.lastSeq
      ? event.data.slice(entry.lastSeq - event.start)
      : event.data
  entry.term.write(data)
  entry.lastSeq = event.end
}

const disposeEntries = (entries: Map<number, TerminalEntry>): void => {
  for (const entry of entries.values()) {
    if (entry.resizeTimer) clearTimeout(entry.resizeTimer)
    entry.term.dispose()
    entry.host.remove()
  }
  entries.clear()
}

export function TerminalView(): React.JSX.Element {
  const sessionId = useAgentSessionId()
  const cwd = useAgentSessionCwd()
  const { resolvedTheme } = useTheme()
  const [state, setState] = useState<SessionTerminalsState>(() => EMPTY_STATE(sessionId))
  const containerRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<number | null>(null)
  const entriesBySessionRef = useRef(new Map<string, Map<number, TerminalEntry>>())
  const loadingSessionRef = useRef<string | null>(null)
  const suppressAutoCreateRef = useRef(false)
  const [theme, setTheme] = useState<ITheme>(() => terminalTheme())
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)

  const entriesForSession = useCallback((id: string): Map<number, TerminalEntry> => {
    let entries = entriesBySessionRef.current.get(id)
    if (!entries) {
      entries = new Map<number, TerminalEntry>()
      entriesBySessionRef.current.set(id, entries)
    }
    return entries
  }, [])

  const currentEntries = useCallback(
    (): Map<number, TerminalEntry> => entriesForSession(sessionId),
    [entriesForSession, sessionId],
  )

  const peekEntries = useCallback(
    (id: string): Map<number, TerminalEntry> | undefined => entriesBySessionRef.current.get(id),
    [],
  )

  useEffect(() => {
    activeIdRef.current = state.activeId
  }, [state.activeId])

  const createTerminal = useCallback(async (): Promise<number> => {
    if (!cwd) throw new Error("Session working directory is not ready")
    return (await window.bridge.invoke("terminal:create", sessionId, { cwd })) as number
  }, [cwd, sessionId])

  const sendResize = useCallback(
    (terminalId: number, entry: TerminalEntry, cols: number, rows: number): void => {
      if (entry.exited) return
      if (entry.lastSentCols === cols && entry.lastSentRows === rows) return
      entry.lastSentCols = cols
      entry.lastSentRows = rows
      void window.bridge
        .invoke("terminal:resize", sessionId, terminalId, cols, rows)
        .catch((error) => {
          if (entry.lastSentCols === cols && entry.lastSentRows === rows) {
            entry.lastSentCols = null
            entry.lastSentRows = null
          }
          console.error("[terminal:resize]", error)
        })
    },
    [sessionId],
  )

  const flushResize = useCallback(
    (terminalId: number, entry: TerminalEntry): void => {
      if (entry.resizeTimer) {
        clearTimeout(entry.resizeTimer)
        entry.resizeTimer = null
      }
      const pending = entry.pendingResize
      entry.pendingResize = null
      if (!pending) return
      sendResize(terminalId, entry, pending.cols, pending.rows)
    },
    [sendResize],
  )

  const scheduleResize = useCallback(
    (terminalId: number, entry: TerminalEntry, cols: number, rows: number): void => {
      if (entry.suppressResize) return
      entry.pendingResize = { cols, rows }
      if (entry.resizeTimer) clearTimeout(entry.resizeTimer)
      entry.resizeTimer = setTimeout(() => flushResize(terminalId, entry), RESIZE_DEBOUNCE_MS)
    },
    [flushResize],
  )

  const closeTerminal = useCallback(
    async (id: number): Promise<void> => {
      const closingLastTerminal = state.terminals.length <= 1
      if (closingLastTerminal) suppressAutoCreateRef.current = true
      try {
        await window.bridge.invoke("terminal:close", sessionId, id)
      } catch (error) {
        if (closingLastTerminal) suppressAutoCreateRef.current = false
        console.error("[terminal:close]", error)
        return
      }
      const entries = currentEntries()
      const entry = entries.get(id)
      if (entry?.resizeTimer) clearTimeout(entry.resizeTimer)
      entry?.term.dispose()
      entry?.host.remove()
      entries.delete(id)
      if (closingLastTerminal) {
        window.dispatchEvent(new CustomEvent("larify:workbench-close", { detail: "terminal" }))
      }
    },
    [currentEntries, sessionId, state.terminals.length],
  )

  const setActive = useCallback(
    async (id: number): Promise<void> => {
      await window.bridge.invoke("terminal:setActive", sessionId, id)
    },
    [sessionId],
  )

  const reorderTerminal = useCallback(
    async (id: number, toIndex: number): Promise<void> => {
      await window.bridge.invoke("terminal:reorder", sessionId, id, toIndex)
    },
    [sessionId],
  )

  const fitActive = useCallback((): void => {
    const id = activeIdRef.current
    if (id == null) return
    const entry = currentEntries().get(id)
    if (!entry) return
    try {
      entry.fit.fit()
    } catch (error) {
      console.error("[terminal:fit]", error)
    }
  }, [currentEntries])

  const ensureEntry = useCallback(
    (terminalId: number, exitCode: number | null): void => {
      const container = containerRef.current
      const entries = currentEntries()
      if (!container || entries.has(terminalId)) return

      const host = document.createElement("div")
      host.className = "absolute inset-0"
      container.appendChild(host)

      const term = new XTerm({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: terminalFontFamily(),
        fontSize: 13,
        rescaleOverlappingGlyphs: true,
        scrollback: 5000,
        theme,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = "11"
      term.onResize(({ cols, rows }) => {
        const entry = entries.get(terminalId)
        if (entry) scheduleResize(terminalId, entry, cols, rows)
      })
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true
        const mod = event.ctrlKey || event.metaKey
        const key = event.key.toLowerCase()
        if (mod && (event.shiftKey || event.metaKey) && key === "c") return !copySelection(term)
        if (mod && (event.shiftKey || event.metaKey) && key === "v") {
          pasteClipboard(term)
          return false
        }
        return true
      })
      try {
        term.open(host)
        fit.fit()
      } catch (error) {
        term.dispose()
        host.remove()
        console.error("[terminal:open]", error)
        return
      }

      const entry: TerminalEntry = {
        term,
        fit,
        host,
        exited: exitCode !== null,
        restoring: false,
        lastSeq: 0,
        pendingData: [],
        pendingResize: null,
        resizeTimer: null,
        lastSentCols: null,
        lastSentRows: null,
        suppressResize: false,
      }
      entries.set(terminalId, entry)

      entry.restoring = true
      const finishRestoring = (): void => {
        entry.restoring = false
        const pending = entry.pendingData
        entry.pendingData = []
        if (entries.get(terminalId) !== entry) return
        for (const event of pending) applyData(entry, event)
      }
      void window.bridge
        .invoke("terminal:snapshot", sessionId, terminalId)
        .then((snapshot) => {
          if (!entries.get(terminalId)) return
          const restore = snapshot as { data: string; seq: number } | null
          if (!restore) {
            finishRestoring()
            return
          }
          entry.term.write(restore.data, () => {
            entry.lastSeq = restore.seq
            finishRestoring()
          })
        })
        .catch((error) => {
          finishRestoring()
          console.error("[terminal:snapshot]", error)
        })

      term.onData((data) => {
        if (entry.exited) return
        void window.bridge
          .invoke("terminal:write", sessionId, terminalId, data)
          .catch((error) => console.error("[terminal:write]", error))
      })
      term.element?.addEventListener("contextmenu", (event) => {
        event.preventDefault()
        if (!copySelection(term)) pasteClipboard(term)
      })
      requestAnimationFrame(fitActive)
      requestAnimationFrame(() => {
        fitActive()
        sendResize(terminalId, entry, term.cols, term.rows)
        flushResize(terminalId, entry)
      })
    },
    [currentEntries, fitActive, flushResize, scheduleResize, sendResize, sessionId, theme],
  )

  useEffect(() => {
    let cancelled = false
    loadingSessionRef.current = sessionId
    setLoadedSessionId(null)
    setState(EMPTY_STATE(sessionId))
    void window.bridge
      .invoke("terminal:getState", sessionId)
      .then((value) => {
        if (cancelled || loadingSessionRef.current !== sessionId) return
        loadingSessionRef.current = null
        setLoadedSessionId(sessionId)
        setState(asState(value, sessionId))
      })
      .catch((error) => {
        console.error("[terminal:getState]", error)
        if (cancelled || loadingSessionRef.current !== sessionId) return
        loadingSessionRef.current = null
        setLoadedSessionId(sessionId)
      })

      const offState = window.bridge.on("terminal:state", (payload) => {
        const next = payload as SessionTerminalsState
        if (next.sessionId !== sessionId) return
        if (loadingSessionRef.current === sessionId) loadingSessionRef.current = null
        setLoadedSessionId(sessionId)
        setState(next)
      })
    const offData = window.bridge.on("terminal:data", (payload) => {
      const event = payload as TerminalDataEvent
      const entry = peekEntries(event.sessionId)?.get(event.terminalId)
      if (!entry) return
      if (entry.restoring) {
        entry.pendingData.push(event)
        return
      }
      applyData(entry, event)
    })
    const offExit = window.bridge.on("terminal:exit", (payload) => {
      const event = payload as TerminalExitEvent
      peekEntries(event.sessionId)
        ?.get(event.terminalId)
        ?.term.write(`\r\n[process exited: ${event.exitCode}]\r\n`)
    })
    return () => {
      cancelled = true
      if (loadingSessionRef.current === sessionId) loadingSessionRef.current = null
      offState()
      offData()
      offExit()
    }
  }, [peekEntries, sessionId])

  useEffect(() => {
    const onActive = (event: Event): void => {
      const visible = (event as CustomEvent<string | null>).detail === "terminal"
      setWorkbenchVisible(visible)
      if (!visible) suppressAutoCreateRef.current = false
    }
    window.addEventListener("larify:workbench-active", onActive)
    window.dispatchEvent(new Event("larify:workbench-active-request"))
    return () => window.removeEventListener("larify:workbench-active", onActive)
  }, [])

  useEffect(() => {
    if (!workbenchVisible) return
    if (loadedSessionId !== sessionId) return
    if (state.terminals.length > 0) return
    if (suppressAutoCreateRef.current) return
    void createTerminal().catch((error) => console.error("[terminal:create]", error))
  }, [createTerminal, loadedSessionId, sessionId, state.terminals.length, workbenchVisible])

  useEffect(() => {
    const entries = currentEntries()
    for (const terminal of state.terminals) {
      ensureEntry(terminal.id, terminal.exitCode)
      const entry = entries.get(terminal.id)
      if (entry) entry.exited = terminal.exitCode !== null
    }

    const alive = new Set(state.terminals.map((terminal) => terminal.id))
    const isLoadingEmptyState = loadingSessionRef.current === state.sessionId && alive.size === 0
    if (!isLoadingEmptyState) {
      for (const [id, entry] of entries) {
        if (!alive.has(id)) {
          if (entry.resizeTimer) clearTimeout(entry.resizeTimer)
          entry.term.dispose()
          entry.host.remove()
          entries.delete(id)
        }
      }
    }

    for (const sessionEntries of entriesBySessionRef.current.values()) {
      for (const entry of sessionEntries.values()) entry.host.style.visibility = "hidden"
    }
    for (const [id, entry] of entries) {
      entry.host.style.visibility = id === state.activeId ? "visible" : "hidden"
    }
    requestAnimationFrame(fitActive)
  }, [currentEntries, ensureEntry, fitActive, state])

  useEffect(() => {
    setTheme(terminalTheme())
  }, [resolvedTheme])

  useEffect(() => {
    for (const entries of entriesBySessionRef.current.values()) {
      for (const entry of entries.values()) entry.term.options.theme = theme
    }
  }, [theme])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => requestAnimationFrame(fitActive))
    observer.observe(container)
    return () => observer.disconnect()
  }, [fitActive])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const container = containerRef.current
      const target = event.target
      if (!container || !(target instanceof Node) || container.contains(target)) return
      for (const entries of entriesBySessionRef.current.values()) {
        for (const entry of entries.values()) entry.term.clearSelection()
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [])

  useEffect(() => {
    const entriesBySession = entriesBySessionRef.current
    return () => {
      for (const entries of entriesBySession.values()) disposeEntries(entries)
      entriesBySession.clear()
    }
  }, [])

  const tabs = state.terminals.map<WorkbenchTab>((terminal) => ({
    active: terminal.id === state.activeId,
    closable: true,
    icon: TERMINAL_ICON,
    id: String(terminal.id),
    title:
      terminal.exitCode === null
        ? terminal.title
        : `${terminal.title} (exited ${terminal.exitCode})`,
  }))

  return (
    <WorkbenchTabsLayout
      draggable
      tabs={tabs}
      onCreate={() => void createTerminal().catch((error) => console.error("[terminal:create]", error))}
      onClose={(id) => void closeTerminal(Number(id))}
      onReorder={(id, _fromIndex, toIndex) => void reorderTerminal(Number(id), toIndex)}
      onSelect={(id) => void setActive(Number(id))}
    >
      <div ref={containerRef} className="larify-terminal-surface absolute inset-0 overflow-hidden bg-background" />
    </WorkbenchTabsLayout>
  )
}
