export interface TerminalCreateOptions {
  cwd?: string
  shell?: string
  shellArgs?: string[]
  shellEnv?: Record<string, string | undefined>
  title?: string
  cols?: number
  rows?: number
}

export interface TerminalState {
  id: number
  pid: number
  title: string
  cwd: string
  shell: string
  shellIntegration?: boolean
  exitCode: number | null
}

export interface TerminalSnapshot {
  data: string
  cols: number
  rows: number
  seq: number
}

export interface TerminalAgentSnapshot {
  screen: string
  isFullscreen?: boolean
  cursorLine?: string
  visualHints?: Array<{
    text: string
    attrs: string[]
  }>
}

export interface SessionTerminalsState {
  sessionId: string
  terminals: TerminalState[]
  activeId: number | null
}

export interface TerminalDataEvent {
  sessionId: string
  terminalId: number
  data: string
  start: number
  end: number
}

export interface TerminalExitEvent {
  sessionId: string
  terminalId: number
  exitCode: number
}
