import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { useTheme } from 'next-themes'
import type { WorkbenchRendererProps } from '@renderer/app/registry/workbench-renderers'
import type {
  SessionTerminalsState,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSnapshot
} from '../shared/types'
import '@xterm/xterm/css/xterm.css'
import './terminal-view.css'

const RESIZE_DEBOUNCE_MS = 100
// Never shrink the terminal below these defaults. fit() below skips resizing
// when the container would force a dimension under the defaults (e.g. while the
// workbench is collapsed / measuring an invisible pane), so a too-small resize
// that makes output wrap/truncate (git diff pager etc.) is avoided.
const MIN_COLS = 80
const MIN_ROWS = 24

const readCssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const readCssVarOr = (name: string, fallback: string): string =>
  readCssVar(name) || readCssVar(fallback)

const terminalTheme = (): ITheme => ({
  background: readCssVar('--background'),
  foreground: readCssVar('--foreground'),
  cursor: readCssVar('--foreground'),
  brightYellow: readCssVar('--foreground'),
  yellow: readCssVar('--foreground'),
  selectionBackground: readCssVar('--primary'),
  selectionForeground: readCssVar('--primary-foreground'),
  selectionInactiveBackground: readCssVar('--muted-foreground'),
  scrollbarSliderBackground: readCssVar('--larify-scrollbar-thumb'),
  scrollbarSliderHoverBackground: readCssVar('--larify-scrollbar-thumb-hover'),
  scrollbarSliderActiveBackground: readCssVarOr(
    '--larify-scrollbar-thumb-active',
    '--larify-scrollbar-thumb-hover'
  )
})

const copySelection = (terminal: XTerm): boolean => {
  const selection = terminal.getSelection()
  if (!selection) return false
  void navigator.clipboard?.writeText(selection).catch(() => undefined)
  terminal.clearSelection()
  return true
}

const pasteClipboard = (terminal: XTerm): void => {
  void navigator.clipboard
    ?.readText()
    .then((text) => {
      if (text) terminal.paste(text)
    })
    .catch(() => undefined)
}

export function TerminalView({
  active = true,
  resourceId: terminalId,
  sessionId
}: WorkbenchRendererProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const lastSeqRef = useRef(0)
  const restoringRef = useRef(true)
  const pendingDataRef = useRef<TerminalDataEvent[]>([])
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fitFrameRef = useRef<number | null>(null)
  const exitedRef = useRef(false)
  const pendingExitRef = useRef<TerminalExitEvent | null>(null)
  const suppressResizeRef = useRef(false)
  const activeRef = useRef(active)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    let active = true
    let hasStateEvent = false
    const applyState = (payload: unknown): boolean => {
      if (!active) return false
      const state = payload as SessionTerminalsState
      if (state.sessionId !== sessionId) return false
      const terminal = state.terminals.find(({ id }) => id === terminalId)
      if (!terminal) return false
      exitedRef.current ||= terminal.exitCode !== null
      return true
    }
    const offState = window.bridge.on('terminal:state', (payload) => {
      hasStateEvent ||= applyState(payload)
    })
    void window.bridge
      .invoke('terminal:getState', sessionId)
      .then((payload) => {
        if (!hasStateEvent) applyState(payload)
      })
      .catch(() => undefined)
    return () => {
      active = false
      offState()
    }
  }, [sessionId, terminalId])

  // Only apply a fit that keeps the terminal at (or above) the default
  // dimensions. When the container is collapsed / too small to hold them, we
  // keep the current (larger) size instead of shrinking, so output is not
  // wrapped/truncated.
  const fit = useCallback((): void => {
    try {
      const fitAddon = fitRef.current
      const dims = fitAddon?.proposeDimensions()
      if (!fitAddon || !dims || isNaN(dims.cols) || isNaN(dims.rows)) return
      if (dims.cols < MIN_COLS || dims.rows < MIN_ROWS) return
      fitAddon.fit()
    } catch {
      // The pane can be measured while it is collapsing.
    }
  }, [])

  const scheduleFit = useCallback((): void => {
    if (fitFrameRef.current !== null) return
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null
      fit()
    })
  }, [fit])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (terminalRef.current) terminalRef.current.options.theme = terminalTheme()
    })
    return () => cancelAnimationFrame(frame)
  }, [resolvedTheme])

  useLayoutEffect(() => {
    activeRef.current = active
    const terminal = terminalRef.current
    if (!terminal) return
    if (active) scheduleFit()
    else terminal.blur()
  }, [active, scheduleFit])

  useEffect(() => {
    let active = true
    const container = containerRef.current
    if (!container) return

    const terminal = new XTerm({
      allowProposedApi: true,
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontFamily: readCssVar('--font-mono'),
      fontSize: 13,
      rescaleOverlappingGlyphs: true,
      scrollback: 5000,
      theme: terminalTheme()
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    terminal.open(container)
    terminalRef.current = terminal
    fitRef.current = fitAddon

    const applyData = (event: TerminalDataEvent): void => {
      if (event.end <= lastSeqRef.current) return
      const data =
        event.start < lastSeqRef.current
          ? event.data.slice(lastSeqRef.current - event.start)
          : event.data
      terminal.write(data)
      lastSeqRef.current = event.end
    }
    const finishRestore = (): void => {
      if (!active) return
      restoringRef.current = false
      for (const event of pendingDataRef.current) applyData(event)
      pendingDataRef.current = []
      if (pendingExitRef.current) {
        terminal.write(`\r\n[process exited: ${pendingExitRef.current.exitCode}]\r\n`)
        pendingExitRef.current = null
      }
      if (activeRef.current) scheduleFit()
    }

    const offData = window.bridge.on('terminal:data', (payload) => {
      const event = payload as TerminalDataEvent
      if (event.sessionId !== sessionId || event.terminalId !== terminalId) return
      if (restoringRef.current) pendingDataRef.current.push(event)
      else applyData(event)
    })
    const offExit = window.bridge.on('terminal:exit', (payload) => {
      const event = payload as TerminalExitEvent
      if (event.sessionId !== sessionId || event.terminalId !== terminalId) return
      exitedRef.current = true
      if (restoringRef.current) pendingExitRef.current = event
      else terminal.write(`\r\n[process exited: ${event.exitCode}]\r\n`)
    })
    const input = terminal.onData((data) => {
      if (!exitedRef.current) {
        void window.bridge
          .invoke('terminal:write', sessionId, terminalId, data)
          .catch(() => undefined)
      }
    })
    const resize = terminal.onResize(({ cols, rows }) => {
      if (restoringRef.current || suppressResizeRef.current || exitedRef.current) return
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null
        if (exitedRef.current) return
        void window.bridge
          .invoke('terminal:resize', sessionId, terminalId, cols, rows)
          .catch(() => undefined)
      }, RESIZE_DEBOUNCE_MS)
    })

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (mod && (event.shiftKey || event.metaKey) && key === 'c') return !copySelection(terminal)
      if (mod && (event.shiftKey || event.metaKey) && key === 'v') {
        pasteClipboard(terminal)
        return false
      }
      return true
    })
    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      if (!copySelection(terminal)) pasteClipboard(terminal)
    }
    container.addEventListener('contextmenu', handleContextMenu)

    fit()
    void window.bridge
      .invoke('terminal:snapshot', sessionId, terminalId)
      .then((value) => {
        if (!active) return
        const snapshot = value as TerminalSnapshot | null
        if (!snapshot) return finishRestore()
        suppressResizeRef.current = true
        try {
          terminal.resize(snapshot.cols, snapshot.rows)
        } finally {
          suppressResizeRef.current = false
        }
        terminal.write(snapshot.data, () => {
          if (!active) return
          lastSeqRef.current = snapshot.seq
          finishRestore()
        })
      })
      .catch(finishRestore)

    const observer = new ResizeObserver(() => {
      if (activeRef.current) scheduleFit()
    })
    observer.observe(container)
    return () => {
      active = false
      observer.disconnect()
      container.removeEventListener('contextmenu', handleContextMenu)
      offData()
      offExit()
      input.dispose()
      resize.dispose()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      lastSeqRef.current = 0
      restoringRef.current = true
      pendingDataRef.current = []
      exitedRef.current = false
      pendingExitRef.current = null
      resizeTimerRef.current = null
      fitFrameRef.current = null
    }
  }, [fit, scheduleFit, sessionId, terminalId])

  return (
    <div
      ref={containerRef}
      data-terminal-active={active}
      className="larify-terminal-surface h-full overflow-hidden bg-background"
    />
  )
}
