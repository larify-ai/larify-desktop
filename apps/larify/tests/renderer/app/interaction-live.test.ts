import { afterEach, describe, expect, it } from 'vitest'

interface Target {
  title: string
  webSocketDebuggerUrl: string
}

interface Response {
  id?: number
  result?: unknown
  error?: unknown
}

interface Evaluation<T> {
  result?: { value?: T }
  exceptionDetails?: { text?: string; exception?: { description?: string } }
}

class DevTools {
  private id = 0
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', ({ data }) => this.receive(String(data)))
  }

  static async connect(): Promise<DevTools> {
    const targets = (await fetch('http://127.0.0.1:9222/json').then((response) =>
      response.json()
    )) as Target[]
    const target = targets.find(({ title }) => title === 'Larify')
    if (!target) throw new Error('Larify DevTools target was not found on port 9222.')

    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('DevTools connection failed.')), {
        once: true
      })
    })
    return new DevTools(socket)
  }

  close(): void {
    this.socket.close()
  }

  async evaluate<T>(expression: string): Promise<T> {
    const evaluation = (await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })) as Evaluation<T>
    if (evaluation.exceptionDetails) {
      throw new Error(
        evaluation.exceptionDetails.exception?.description ??
          evaluation.exceptionDetails.text ??
          'DevTools evaluation failed.'
      )
    }
    return evaluation.result?.value as T
  }

  async click(expression: string): Promise<void> {
    await this.evaluate(`(() => {
      const element = ${expression};
      if (!element) throw new Error('Clickable element was not found.');
      element.click();
    })()`)
  }

  async reload(): Promise<void> {
    await this.send('Page.reload', { ignoreCache: true })
  }

  private send(method: string, params: object): Promise<unknown> {
    const id = ++this.id
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  private receive(data: string): void {
    const response = JSON.parse(data) as Response
    if (!response.id) return
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.error) pending.reject(response.error)
    else pending.resolve(response.result)
  }
}

describe.skipIf(!process.env.LIVE)('Interaction live integration', () => {
  let devtools: DevTools | undefined

  afterEach(() => devtools?.close())

  it('sends a message and restores its session title after reload', async () => {
    devtools = await DevTools.connect()
    const marker = `LARIFY_UI_${Date.now()}`

    await devtools.click(`
      [...document.querySelectorAll('nav button')].find(
        (button) => button.textContent?.includes('\u65b0\u5efa\u4efb\u52a1')
      )
    `)
    await devtools.evaluate(`(() => {
      const textarea = [...document.querySelectorAll('textarea')].find(
        (element) => element.getClientRects().length > 0
      );
      if (!textarea) throw new Error('Composer was not found.');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, ${JSON.stringify(`Reply with exactly: ${marker}`)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)

    await waitFor(async () =>
      devtools?.evaluate(`(() => {
        const textarea = [...document.querySelectorAll('textarea')].find(
          (element) => element.getClientRects().length > 0
        );
        return !textarea?.closest('form')?.querySelector('button[type="submit"]')?.disabled;
      })()`)
    )
    await devtools.click(`
      [...document.querySelectorAll('textarea')].find(
        (element) => element.getClientRects().length > 0
      )?.closest('form')?.querySelector('button[type="submit"]')
    `)

    await waitFor(
      async () =>
        (await devtools!.evaluate<number>(
          `document.body.innerText.split(${JSON.stringify(marker)}).length - 1`
        )) >= 2,
      60_000
    )
    expect(
      await devtools.evaluate<number>(
        `document.body.innerText.split(${JSON.stringify(marker)}).length - 1`
      )
    ).toBeGreaterThanOrEqual(2)

    await waitFor(
      async () =>
        devtools?.evaluate(
          `[...document.querySelectorAll('nav button')].some((button) => button.textContent?.includes(${JSON.stringify(marker)}))`
        ),
      15_000
    )

    await devtools.reload()
    await waitFor(
      async () =>
        devtools?.evaluate(
          `document.readyState === 'complete' && [...document.querySelectorAll('nav button')].some((button) => button.textContent?.includes(${JSON.stringify(marker)}))`
        ),
      15_000
    )
  }, 70_000)

  it('keeps history rendered during high-speed scrolling and returns to bottom', async () => {
    devtools = await DevTools.connect()
    await devtools.reload()
    await waitFor(() => devtools!.evaluate(`document.readyState === 'complete'`))
    await revealNavigationItem(devtools, '5000')
    await devtools.click(
      `(() => {
        return [...document.querySelectorAll('nav button')].find(
          (button) => button.textContent?.includes('5000')
        );
      })()`
    )
    await waitFor(async () =>
      devtools?.evaluate(
        `[...document.querySelectorAll('[role="log"]')].some(
          (element) => element.getClientRects().length > 0 && element.scrollHeight > element.clientHeight
        )`
      )
    )

    for (const position of [1, 0.66, 0.33, 0]) {
      await scrollTo(devtools, position)
      await waitFor(() => hasVisibleHistory(devtools), 10_000)
    }

    await waitFor(() =>
      devtools!.evaluate(`Boolean(document.querySelector('button[aria-label="返回底部"]'))`)
    )
    await devtools.click(`document.querySelector('button[aria-label="返回底部"]')`)
    await waitFor(async () => {
      const distance = await devtools?.evaluate<number>(`(() => {
        ${visibleScroller()};
        return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      })()`)
      return distance !== undefined && distance < 4
    })
  }, 45_000)
})

async function revealNavigationItem(devtools: DevTools, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const visible = await devtools.evaluate<boolean>(
      `[...document.querySelectorAll('nav button')].some((button) => button.textContent?.includes(${JSON.stringify(text)}))`
    )
    if (visible) return
    const count = await devtools.evaluate<number>(`document.querySelectorAll('nav button').length`)
    await devtools.click(
      `[...document.querySelectorAll('nav button')].find((button) => button.textContent?.trim() === '\u66f4\u591a')`
    )
    await waitFor(
      () =>
        devtools.evaluate(
          `document.querySelectorAll('nav button').length !== ${count} || ![...document.querySelectorAll('nav button')].some((button) => button.textContent?.trim() === '\u66f4\u591a')`
        ),
      2_000
    )
  }
  throw new Error(`Navigation item containing "${text}" was not revealed.`)
}

async function scrollTo(devtools: DevTools, position: number): Promise<void> {
  await devtools.evaluate(`(() => {
    ${visibleScroller()};
    scroller.scrollTop = ${position} * (scroller.scrollHeight - scroller.clientHeight);
  })()`)
}

async function hasVisibleHistory(devtools: DevTools): Promise<boolean> {
  return devtools.evaluate(`(() => {
    ${visibleScroller()};
    if (scroller.parentElement?.querySelector('[data-scroll-placeholder]')) return true;
    const viewport = scroller.getBoundingClientRect();
    return [...scroller.querySelectorAll('[data-item-index]')].some((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
  })()`)
}

function visibleScroller(): string {
  return `const scroller = [...document.querySelectorAll('[role="log"]')]
    .find((element) => element.getClientRects().length > 0 && element.scrollHeight > element.clientHeight);
  if (!(scroller instanceof HTMLElement)) throw new Error('Message scroller was not found.')`
}

async function waitFor(check: () => Promise<unknown>, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      // Reloads temporarily invalidate the page's execution context.
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (lastError instanceof Error) throw lastError
  throw new Error(`Condition was not met within ${timeout} ms.`)
}
