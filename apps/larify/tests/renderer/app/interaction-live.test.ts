import { afterEach, describe, expect, it } from 'vitest'

interface Target {
  title: string
  webSocketDebuggerUrl: string
}

interface Response {
  id?: number
  result?: { result?: { value?: unknown } }
  error?: unknown
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
    const result = (await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })) as { result?: { value?: T } }
    return result.result?.value as T
  }

  async click(expression: string): Promise<void> {
    await this.evaluate(`(() => {
      const element = ${expression};
      if (!element) throw new Error('Clickable element was not found.');
      element.click();
    })()`)
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

  it('sends a message through the running app and receives the real response', async () => {
    devtools = await DevTools.connect()
    const marker = `LARIFY_UI_${Date.now()}`

    await devtools.click(
      `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '新建任务')`
    )
    await devtools.evaluate(`(() => {
      const textarea = document.querySelector('textarea');
      if (!textarea) throw new Error('Composer was not found.');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, ${JSON.stringify(`只回复：${marker}`)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)

    await waitFor(async () =>
      devtools?.evaluate(`!document.querySelector('button[aria-label="发送"]')?.disabled`)
    )
    await devtools.click(`document.querySelector('button[aria-label="发送"]')`)

    await waitFor(
      async () =>
        devtools?.evaluate(`(() => {
          const send = document.querySelector('button[aria-label="发送"]');
          const occurrences = document.body.innerText.split(${JSON.stringify(marker)}).length - 1;
          return occurrences >= 2 && send?.disabled === true;
        })()`),
      60_000
    )

    expect(
      await devtools.evaluate(`document.body.innerText.split(${JSON.stringify(marker)}).length - 1`)
    ).toBeGreaterThanOrEqual(2)
  }, 70_000)

  it('keeps placeholders visible during high-speed history scrolling', async () => {
    devtools = await DevTools.connect()
    await devtools.click(
      `(() => {
        const label = [...document.querySelectorAll('*')].find(
          (element) => !element.children.length && element.textContent?.includes('5000')
        );
        return label?.closest('button, [role="button"]') ?? label?.parentElement;
      })()`
    )

    await waitFor(async () =>
      devtools?.evaluate(
        `Math.max(...[...document.querySelectorAll('[data-testid="virtuoso-scroller"]')].map((element) => element.scrollHeight)) > 10000`
      )
    )

    const emptyFrames = await devtools.evaluate<number>(`(async () => {
      const scroller = [...document.querySelectorAll('[data-testid="virtuoso-scroller"]')]
        .sort((left, right) => right.scrollHeight - left.scrollHeight)[0];
      if (!(scroller instanceof HTMLElement)) throw new Error('Message scroller was not found.');
      let empty = 0;
      for (let frame = 0; frame < 90; frame++) {
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - frame * 5000);
        await new Promise(requestAnimationFrame);
        if (scroller.parentElement?.querySelector('[data-scroll-overlay]')) continue;
        const items = [...scroller.querySelectorAll('[data-item-index]')];
        const visible = items.some((item) => {
          const rect = item.getBoundingClientRect();
          const viewport = scroller.getBoundingClientRect();
          return rect.bottom > viewport.top && rect.top < viewport.bottom;
        });
        if (!visible) empty++;
      }
      return empty;
    })()`)

    expect(emptyFrames).toBe(0)
  }, 20_000)
})

async function waitFor(check: () => Promise<unknown>, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Condition was not met within ${timeout} ms.`)
}
