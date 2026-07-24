import type { CdpSend } from './snapshotCapture'

const DEFAULT_TIMEOUT = 25_000
const POLL_INTERVAL = 100

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const abortError = (): Error => new Error('operation aborted')

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

async function evalBool(send: CdpSend, expression: string): Promise<boolean> {
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
  return res.result?.value === true
}

class EvaluationError extends Error {}

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
      if (await check()) return
    } catch (error) {
      if (error instanceof EvaluationError) throw error
    }
    if (signal?.aborted) throw abortError()
    if (Date.now() >= deadline) throw new Error(`${label} timed out after ${formatTimeout(timeoutMs)}`)
    await sleepUntilPoll(POLL_INTERVAL, signal)
  }
}

function selectorExpr(selector: string, state: WaitState): string {
  const sel = JSON.stringify(selector)
  const visible = `(el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) <= 0) return false;
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
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
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
  await poll(() => evalBool(send, expr), timeoutMs, `wait_for_selector ${selector} (${state})`, signal)
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
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<void> {
  const expr = `!!(${expression})`
  await poll(() => evalBool(send, expr), timeoutMs, 'wait_for_function')
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
