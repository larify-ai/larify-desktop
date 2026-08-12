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

interface StoredSession {
  id: string
  title: string
  messageCount: number
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
    const session = await findLongestSession(devtools)
    expect(session.messageCount).toBeGreaterThan(50)
    await revealNavigationItem(devtools, session.id)
    await devtools.click(
      `document.querySelector('nav button[data-session-id="' + CSS.escape(${JSON.stringify(session.id)}) + '"]')`
    )
    await waitFor(async () =>
      devtools?.evaluate(
        `[...document.querySelectorAll('[role="log"]')].some(
          (element) => element.getClientRects().length > 0 && element.scrollHeight > element.clientHeight
        )`
      )
    )

    const initial = await devtools.evaluate<{
      samples: number
      firstDistance: number
      lastDistance: number
      maxDistance: number
      awayFrames: number
      button: boolean
    }>(
      `(async () => {
        const values = [];
        let button = false;
        for (let frame = 0; frame < 180; frame++) {
          await new Promise(requestAnimationFrame);
          const scroller = [...document.querySelectorAll('[role="log"]')].find(
            (element) => element.getClientRects().length > 0 && element.scrollHeight > element.clientHeight
          );
          if (scroller) values.push(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
          button ||= Boolean(document.querySelector('button[aria-label="\u8fd4\u56de\u5e95\u90e8"]'));
        }
        return {
          samples: values.length,
          firstDistance: values[0] ?? Number.MAX_SAFE_INTEGER,
          lastDistance: values.at(-1) ?? Number.MAX_SAFE_INTEGER,
          maxDistance: values.length ? Math.max(...values) : Number.MAX_SAFE_INTEGER,
          awayFrames: values.filter((value) => value >= 4).length,
          button
        };
      })()`
    )
    expect(initial.samples).toBeGreaterThan(0)
    expect(initial.maxDistance).toBeLessThan(4)
    expect(initial.button).toBe(false)

    for (const position of [1, 0.66, 0.33, 0]) {
      await scrollTo(devtools, position)
      await waitFor(() => hasVisibleHistory(devtools), 10_000)
    }

    await waitFor(() =>
      devtools!.evaluate(`
        [...document.querySelectorAll('button[aria-label="返回底部"]')].some(
          (button) => button.getClientRects().length > 0
        )
      `)
    )
    await devtools.click(
      `[...document.querySelectorAll('button[aria-label="返回底部"]')].find(
        (button) => button.getClientRects().length > 0
      )`
    )
    await waitForBottom(devtools)

    await scrollTo(devtools, 0)
    const otherSessionId = await devtools.evaluate<string | null>(`
      [...document.querySelectorAll('nav button[data-session-id]')].find(
        (button) => button.dataset.sessionId !== ${JSON.stringify(session.id)}
      )?.dataset.sessionId ?? null
    `)
    expect(otherSessionId).not.toBeNull()
    await devtools.click(
      `document.querySelector('nav button[data-session-id="' + CSS.escape(${JSON.stringify(otherSessionId)}) + '"]')`
    )
    await waitFor(() =>
      devtools!.evaluate(
        `document.querySelector('nav button[aria-current="page"]')?.dataset.sessionId === ${JSON.stringify(otherSessionId)}`
      )
    )
    await devtools.click(
      `document.querySelector('nav button[data-session-id="' + CSS.escape(${JSON.stringify(session.id)}) + '"]')`
    )
    await waitForBottom(devtools)
    expect(
      await devtools.evaluate(`
        [...document.querySelectorAll('button[aria-label="返回底部"]')].some(
          (button) => button.getClientRects().length > 0
        )
      `)
    ).toBe(false)
  }, 45_000)

  it('does not pull the reader back during streaming after scrolling upward', async () => {
    devtools = await DevTools.connect()
    const session = await findLongestSession(devtools)
    expect(session.messageCount).toBeGreaterThan(50)
    await revealNavigationItem(devtools, session.id)
    await devtools.click(`
      document.querySelector(
        'nav button[data-session-id="' + CSS.escape(${JSON.stringify(session.id)}) + '"]'
      )
    `)
    await submitPrompt(
      devtools,
      '\u8bf7\u4ece 1 \u5230 200 \u9010\u884c\u8f93\u51fa\u6570\u5b57\uff0c\u6bcf\u884c\u53ea\u8f93\u51fa\u4e00\u4e2a\u6570\u5b57\uff0c\u4e0d\u8981\u7701\u7565\u3002'
    )
    await waitFor(
      () =>
        devtools!.evaluate(`Boolean(document.querySelector('button[aria-label="\u505c\u6b62"]'))`),
      15_000
    )
    await waitFor(() =>
      devtools!.evaluate(`
        [...document.querySelectorAll('[role="log"]')].some(
          (element) => element.getClientRects().length > 0 &&
            element.scrollHeight - element.clientHeight > 300
        )
      `)
    )

    await devtools.evaluate(`(() => {
      ${visibleScroller()};
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
      scroller.scrollTop = 0;
    })()`)
    const distances = await devtools.evaluate<number[]>(`(async () => {
      const values = [];
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(requestAnimationFrame);
        ${visibleScroller()};
        values.push(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
      }
      return values;
    })()`)
    expect(Math.min(...distances)).toBeGreaterThan(100)

    const stop = await devtools.evaluate<boolean>(
      `Boolean(document.querySelector('button[aria-label="\u505c\u6b62"]'))`
    )
    if (stop) {
      await devtools.click(`document.querySelector('button[aria-label="\u505c\u6b62"]')`)
    }
  }, 60_000)
})

async function submitPrompt(devtools: DevTools, prompt: string): Promise<void> {
  await devtools.evaluate(`(() => {
    const textarea = [...document.querySelectorAll('textarea')].find(
      (element) => element.getClientRects().length > 0
    );
    if (!textarea) throw new Error('Composer was not found.');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, ${JSON.stringify(prompt)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await waitFor(() =>
    devtools.evaluate(`(() => {
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
}

async function findLongestSession(devtools: DevTools): Promise<StoredSession> {
  const session = await devtools.evaluate<StoredSession | null>(`(async () => {
    const cwds = await window.bridge.invoke('session:cwds');
    const sessions = [];
    for (const cwd of [...new Set([...(Array.isArray(cwds) ? cwds : []), ''])]) {
      const page = await window.bridge.invoke('session:list', cwd, 0, 1000);
      if (Array.isArray(page)) sessions.push(...page);
    }
    const unique = [...new Map(sessions.map((item) => [item.id, item])).values()];
    const counts = await Promise.all(unique.map(async (item) => ({
      id: item.id,
      title: item.title,
      messageCount: await window.bridge.invoke('session:msg-count', item.id)
    })));
    return counts.sort((a, b) => b.messageCount - a.messageCount)[0] ?? null;
  })()`)
  if (!session) throw new Error('No stored conversation was found.')
  return session
}

async function revealNavigationItem(devtools: DevTools, id: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const visible = await devtools.evaluate<boolean>(
      `Boolean(document.querySelector('nav button[data-session-id="' + CSS.escape(${JSON.stringify(id)}) + '"]'))`
    )
    if (visible) return
    const clicked = await devtools.evaluate<number>(`(() => {
      const buttons = [...document.querySelectorAll('nav button')].filter(
        (button) => button.textContent?.trim() === '\u66f4\u591a'
      );
      buttons.forEach((button) => button.click());
      return buttons.length;
    })()`)
    if (!clicked) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Navigation item for session "${id}" was not revealed.`)
}

async function scrollTo(devtools: DevTools, position: number): Promise<void> {
  await devtools.evaluate(`(() => {
    ${visibleScroller()};
    scroller.scrollTop = ${position} * (scroller.scrollHeight - scroller.clientHeight);
  })()`)
}

async function waitForBottom(devtools: DevTools): Promise<void> {
  let distance = Number.MAX_SAFE_INTEGER
  try {
    await waitFor(async () => {
      distance = await devtools.evaluate<number>(`(() => {
        ${visibleScroller()};
        return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      })()`)
      return distance < 4
    })
  } catch {
    throw new Error(`Message scroller remained ${distance}px away from the bottom.`)
  }
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
