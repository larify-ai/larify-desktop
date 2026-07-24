import { app, BrowserWindow, nativeImage, screen } from 'electron'
import { createServer, type Server } from 'node:http'
import { BrowserTab } from '../../../../src/extensions/browser/main/tab'

app.commandLine.appendSwitch('site-per-process')

function listen(host: string, html: () => string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(html())
    })
    server.listen(0, host, () => resolve(server))
  })
}

function url(server: Server, host: string): string {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind')
  return `http://${host}:${address.port}`
}

async function waitForRef(tab: BrowserTab): Promise<string> {
  const deadline = Date.now() + 10_000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    lastSnapshot = await tab.snapshot()
    const match = lastSnapshot.match(/button "OOPIF" \[ref=(e\d+)\]/)
    if (match) return `@${match[1]}`
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`OOPIF target ref was not captured:\n${lastSnapshot}`)
}

function assertGreenCorners(data: string): { width: number; height: number } {
  const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const points = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3]
  ]
  for (const [x, y] of points) {
    const offset = (y * width + x) * 4
    const [blue, green, red, alpha] = bitmap.subarray(offset, offset + 4)
    if (red > 10 || green < 180 || blue > 10 || alpha < 250) {
      throw new Error(
        `unexpected corner pixel at (${x},${y}): rgba(${red},${green},${blue},${alpha})`
      )
    }
  }
  return { width, height }
}

async function main(): Promise<void> {
  let childServer: Server | undefined
  let rootServer: Server | undefined
  let window: BrowserWindow | undefined
  let tab: BrowserTab | undefined
  try {
    childServer = await listen(
      '127.0.0.1',
      () => `<!doctype html><style>
        html,body{margin:0;min-height:1200px;background:#ffff00}
        #target{position:absolute;left:30px;top:400px;width:100px;height:60px;
          border:0;padding:0;background:#00c800;color:#000}
      </style><button id="target">OOPIF</button><script>scrollTo(0,300)</script>`
    )
    const childUrl = url(childServer, '127.0.0.1')
    rootServer = await listen(
      'localhost',
      () => `<!doctype html><style>
        html,body{margin:0;min-height:1800px;background:#00ffff}
        iframe{position:absolute;left:150px;top:700px;width:400px;height:300px;
          border:10px solid #c80000;transform:scale(1.25);transform-origin:top left}
      </style><iframe src="${childUrl}"></iframe><script>scrollTo(0,500)</script>`
    )

    await app.whenReady()
    window = new BrowserWindow({ show: true, x: -2000, y: -2000, width: 900, height: 700 })
    tab = new BrowserTab(1, `oopif-live-${Date.now()}`)
    window.contentView.addChildView(tab.view)
    tab.view.setBounds({ x: 0, y: 0, width: 900, height: 700 })
    await tab.navigateAndWait(url(rootServer, 'localhost'))

    const ref = await waitForRef(tab)
    const screenshot = await tab.screenshot({ selector: ref, format: 'png' })
    const size = assertGreenCorners(screenshot.data)
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor
    const expected = { width: 125 * scaleFactor, height: 75 * scaleFactor }
    if (
      Math.abs(size.width - expected.width) > 1 ||
      Math.abs(size.height - expected.height) > 1
    ) {
      throw new Error(
        `unexpected screenshot size ${size.width}x${size.height}; expected ${expected.width}x${expected.height}`
      )
    }
    console.log(
      `PASS BrowserTab OOPIF screenshot: ${size.width}x${size.height}, scaleFactor=${scaleFactor}`
    )
  } finally {
    tab?.destroy()
    window?.destroy()
    await Promise.all([
      new Promise<void>((resolve) => childServer?.close(() => resolve()) ?? resolve()),
      new Promise<void>((resolve) => rootServer?.close(() => resolve()) ?? resolve())
    ])
  }
}

void main().then(
  () => app.exit(0),
  (error) => {
    console.error(error)
    app.exit(1)
  }
)
