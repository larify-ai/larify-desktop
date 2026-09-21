import type { CdpSend } from './snapshotCapture'

const DEFAULT_TIMEOUT = 25_000
const POLL_INTERVAL = 100

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const abortError = (): Error => new Error('operation aborted')

export async function waitForOperationOrAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  message = 'operation aborted'
): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) {
    void operation.catch(() => {})
    throw new Error(message)
  }
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error(message))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function sleepUntilPoll(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms)
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const formatTimeout = (timeoutMs: number): string => `${timeoutMs / 1000}s`

export type WaitState = 'visible' | 'attached' | 'detached' | 'hidden'

async function evalValue(send: CdpSend, expression: string): Promise<unknown> {
  const res = (await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })) as {
    result?: { value?: unknown }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }
  if (res.exceptionDetails) {
    throw new EvaluationError(
      res.exceptionDetails.exception?.description ??
        res.exceptionDetails.text ??
        'Runtime.evaluate failed'
    )
  }
  return res.result?.value
}

async function evalBool(send: CdpSend, expression: string): Promise<boolean> {
  return (await evalValue(send, expression)) === true
}

class EvaluationError extends Error {}

/**
 * A `poll` / `waitForStable` deadline elapsed without the condition holding.
 *
 * Exported and thrown AS A CLASS (not a bare `Error`) so callers that intentionally
 * fall back on a timeout can detect it structurally via {@link isTimeoutError}
 * instead of string-matching the message. See memory/larify-desktop/dom-query-race-family.md.
 */
export class WaitTimeoutError extends Error {}

/**
 * True when `error` is a wait deadline {@link WaitTimeoutError}.
 *
 * Callers use this to distinguish "the condition never became true within the
 * budget" (→ fall back to their original single read) from a real failure such as
 * an invalid selector or a closed tab (→ propagate unchanged). String-matching the
 * timeout message is deliberately avoided: rewording a message must not silently
 * disable every fallback.
 */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof WaitTimeoutError
}

/**
 * True when `error` is the page-side parse failure raised by an invalid selector — a CSS
 * `SyntaxError` (`… is not a valid selector` / `Failed to execute 'querySelector'`) or a broken
 * XPath expression.
 *
 * Callers that probe with the SAME selector they later read use this to swallow the parse failure
 * during the probe, so the read can still classify it as `selector '…' is invalid` instead of
 * leaking Chromium's raw message. Terminal transport errors (a closed tab, a detached frame, …)
 * deliberately do NOT match and must keep propagating.
 */
export function isSelectorParseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /SyntaxError|is not a valid selector|querySelector|XPath/i.test(error.message)
}

export const timeoutError = (label: string, timeoutMs: number): WaitTimeoutError =>
  new WaitTimeoutError(`${label} timed out after ${formatTimeout(timeoutMs)}`)

function isTerminalCdpError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /(?:tab was closed|target closed|session closed|webcontents was destroyed|object has been destroyed|render frame was disposed|debugger is not attached)/i.test(
    error.message
  )
}

async function poll(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (signal?.aborted) throw abortError()
    try {
      if (await waitForOperationOrAbort(check(), signal)) return
    } catch (error) {
      if (error instanceof EvaluationError || isTerminalCdpError(error)) throw error
    }
    if (signal?.aborted) throw abortError()
    if (Date.now() >= deadline) throw timeoutError(label, timeoutMs)
    await sleepUntilPoll(POLL_INTERVAL, signal)
  }
}

function selectorExpr(selector: string, state: WaitState): string {
  const sel = JSON.stringify(selector)
  const visible = `(el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let node = el; node && node.nodeType === 1;) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) <= 0) return false;
      const root = node.getRootNode && node.getRootNode();
      node = node.parentElement || (root && root.host) || null;
    }
    return true;
  }`
  switch (state) {
    case 'attached':
      return `!!document.querySelector(${sel})`
    case 'detached':
      return `!document.querySelector(${sel})`
    case 'hidden':
      return `(() => { const el = document.querySelector(${sel}); return !el || !(${visible})(el); })()`
    default:
      return `(() => { const el = document.querySelector(${sel}); return !!el && (${visible})(el); })()`
  }
}

export function urlMatches(pattern: string, url: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return url.includes(pattern)
  const parts = pattern.replace(/\*+/g, '*').split('*')
  let idx = 0
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (seg === '') continue
    if (i === 0) {
      if (!url.startsWith(seg)) return false
      idx = seg.length
    } else if (i === parts.length - 1) {
      if (!url.endsWith(seg) || url.length - seg.length < idx) return false
    } else {
      const found = url.indexOf(seg, idx)
      if (found === -1) return false
      idx = found + seg.length
    }
  }
  return true
}

export function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms)
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function waitForSelector(
  send: CdpSend,
  selector: string,
  state: WaitState = 'visible',
  timeoutMs: number = DEFAULT_TIMEOUT,
  signal?: AbortSignal
): Promise<void> {
  const expr = selectorExpr(selector, state)
  await poll(
    () => evalBool(send, expr),
    timeoutMs,
    `wait_for_selector ${selector} (${state})`,
    signal
  )
}

export interface StableOptions {
  pollMs?: number
  stableTimes?: number
  timeoutMs?: number
}

/**
 * Polls `expression` until it returns a non-null value that stays identical for
 * `stableTimes` consecutive samples, then resolves with that value.
 *
 * Why not `waitForSelector`: on a client-hydrated search page the placeholder results
 * use the SAME selectors as the final results, so mere presence is not enough. The
 * caller passes an expression that returns `null` while the page is still meaningfully
 * unstable, and the settled value once it is final.
 * See memory/larify-desktop/bing-hydration-window.md.
 *
 * `stableTimes` is the number of consecutive identical samples required before settling, so
 * `stableTimes: 1` settles on the first non-null sample and `stableTimes: 2` (the default)
 * needs one repeat, which is what steps over the empty-placeholder state.
 *
 * Failure semantics (deliberately the SAME as `poll`, so the two primitives do not drift):
 * - a transient evaluation failure (e.g. `Execution context was destroyed` during a
 *   hydration-triggered navigation) is RETRIED, exactly like `waitForSelector` does
 * - the expression throwing a parse error (`EvaluationError`) or a terminal CDP error
 *   (`tab was closed`, …) aborts polling
 * - aborting the signal rejects with `operation aborted`
 * - otherwise it times out with a {@link WaitTimeoutError} (caller decides how to fall back)
 */
export async function waitForStable(
  send: CdpSend,
  expression: string,
  { pollMs = POLL_INTERVAL, stableTimes = 2, timeoutMs = DEFAULT_TIMEOUT }: StableOptions = {},
  signal?: AbortSignal
): Promise<unknown> {
  const samples = Math.max(1, stableTimes)
  const interval = Math.max(1, pollMs)
  const deadline = Date.now() + timeoutMs
  let previous: string | undefined
  let streak = 0
  for (;;) {
    if (signal?.aborted) throw abortError()
    let value: unknown
    let seen = true
    try {
      value = await waitForOperationOrAbort(evalValue(send, expression), signal)
    } catch (error) {
      // Mirror `poll`: a transient evaluation failure is retried, everything else aborts.
      if (error instanceof EvaluationError || isTerminalCdpError(error)) throw error
      seen = false
      value = null
    }
    if (seen && value !== null) {
      const serialized = JSON.stringify(value)
      if (serialized === previous) streak += 1
      else {
        previous = serialized
        streak = 1
      }
      if (streak >= samples) return value
    } else {
      previous = undefined
      streak = 0
    }
    if (signal?.aborted) throw abortError()
    if (Date.now() >= deadline) throw timeoutError('wait_for_stable', timeoutMs)
    await sleepUntilPoll(interval, signal)
  }
}

export async function waitForText(
  send: CdpSend,
  text: string,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<void> {
  const expr = `((document.body && document.body.innerText) || '').includes(${JSON.stringify(text)})`
  await poll(() => evalBool(send, expr), timeoutMs, `wait_for_text ${JSON.stringify(text)}`)
}

export async function waitForFunction(
  send: CdpSend,
  expression: string,
  timeoutMs: number = DEFAULT_TIMEOUT,
  signal?: AbortSignal
): Promise<void> {
  const expr = `!!(${expression})`
  await poll(() => evalBool(send, expr), timeoutMs, 'wait_for_function', signal)
}

export async function waitForUrl(
  send: CdpSend,
  pattern: string,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<void> {
  await poll(
    async () => {
      const res = (await send('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true
      })) as { result?: { value?: unknown } }
      return urlMatches(pattern, String(res.result?.value ?? ''))
    },
    timeoutMs,
    `wait_for_url ${pattern}`
  )
}
