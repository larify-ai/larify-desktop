export interface ConsoleEntry {
  type: string
  text: string
  timestamp?: number
  url?: string
}

export interface ErrorEntry {
  message: string
  stack?: string
  url?: string
  line?: number
  column?: number
  timestamp?: number
}

const CONSOLE_CAP = 1000
const ERROR_CAP = 1000

interface RemoteObject {
  type?: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  description?: string
  preview?: {
    subtype?: string
    description?: string
    overflow?: boolean
    properties?: Array<{ name: string; type: string; value?: string }>
  }
}

interface CallFrame {
  functionName?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
}
interface StackTrace {
  callFrames?: CallFrame[]
}

interface ConsoleApiParams {
  type?: string
  args?: RemoteObject[]
  timestamp?: number
  stackTrace?: StackTrace
}
interface ExceptionParams {
  timestamp?: number
  exceptionDetails?: {
    text?: string
    url?: string
    lineNumber?: number
    columnNumber?: number
    exception?: { description?: string }
    stackTrace?: StackTrace
  }
}

// RemoteObject -> readable text, one level deep only (mirrors agent-browser format_console_arg).
// Returns null for an arg that cannot be formatted, so it is dropped from the joined output.
function formatArg(arg: RemoteObject): string | null {
  if (arg.type === 'undefined') return 'undefined'
  if (arg.subtype === 'null') return 'null'
  if ('value' in arg && arg.value !== undefined) {
    return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value)
  }
  if (arg.unserializableValue) return arg.unserializableValue
  const p = arg.preview
  if (p) {
    if (['map', 'set', 'weakmap', 'weakset'].includes(p.subtype ?? ''))
      return arg.description ?? p.description ?? null
    const isArray = p.subtype === 'array' || arg.subtype === 'array'
    const items = (p.properties ?? [])
      .filter((x) => x.value !== undefined)
      .map((x) => {
        const v = x.type === 'string' ? `"${x.value}"` : x.value
        return isArray ? v : `${x.name}: ${v}`
      })
    return (isArray ? '[' : '{') + items.join(', ') + (p.overflow ? ', ...' : '') + (isArray ? ']' : '}')
  }
  return arg.description ?? null
}

function formatArgs(args: RemoteObject[]): string {
  return args
    .map(formatArg)
    .filter((s): s is string => s !== null)
    .join(' ')
}

function firstStackUrl(stack?: StackTrace): string | undefined {
  return stack?.callFrames?.[0]?.url || undefined
}

function formatStack(stack?: StackTrace): string | undefined {
  const frames = stack?.callFrames
  if (!frames?.length) return undefined
  return frames
    .map((f) => `    at ${f.functionName || '<anonymous>'} (${f.url ?? '<anonymous>'}:${f.lineNumber}:${f.columnNumber})`)
    .join('\n')
}

export function parseConsoleEvent(params: ConsoleApiParams): ConsoleEntry {
  return {
    type: params.type ?? 'log',
    text: formatArgs(params.args ?? []),
    timestamp: params.timestamp,
    url: firstStackUrl(params.stackTrace)
  }
}

export function parseExceptionEvent(params: ExceptionParams): ErrorEntry {
  const d = params.exceptionDetails ?? {}
  return {
    message: d.exception?.description ?? d.text ?? 'Uncaught error',
    stack: formatStack(d.stackTrace),
    url: d.url || firstStackUrl(d.stackTrace),
    line: d.lineNumber,
    column: d.columnNumber,
    timestamp: params.timestamp
  }
}

export class ConsoleBuffer {
  private console: ConsoleEntry[] = []
  private errors: ErrorEntry[] = []
  private consoleDropped = 0
  private errorsDropped = 0

  addConsole(entry: ConsoleEntry): void {
    this.console.push(entry)
    if (this.console.length > CONSOLE_CAP) {
      this.console.shift()
      this.consoleDropped++
    }
  }

  addError(entry: ErrorEntry): void {
    this.errors.push(entry)
    if (this.errors.length > ERROR_CAP) {
      this.errors.shift()
      this.errorsDropped++
    }
  }

  readConsole(
    opts: { level?: string; limit?: number; clear?: boolean } = {}
  ): { entries: ConsoleEntry[]; dropped: number } {
    const filtered = opts.level ? this.console.filter((e) => e.type === opts.level) : this.console.slice()
    const entries = opts.limit == null ? filtered : opts.limit > 0 ? filtered.slice(-opts.limit) : []
    const dropped = this.consoleDropped
    if (opts.clear) {
      if (opts.level) {
        this.console = this.console.filter((e) => e.type !== opts.level)
      } else {
        this.console = []
        this.consoleDropped = 0
      }
    }
    return { entries, dropped }
  }

  readErrors(opts: { clear?: boolean } = {}): { entries: ErrorEntry[]; dropped: number } {
    const entries = this.errors.slice()
    const dropped = this.errorsDropped
    if (opts.clear) {
      this.errors = []
      this.errorsDropped = 0
    }
    return { entries, dropped }
  }
}
