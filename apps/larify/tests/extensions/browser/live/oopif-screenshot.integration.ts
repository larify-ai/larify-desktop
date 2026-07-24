import { app, BrowserWindow, nativeImage, screen } from 'electron'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserService } from '../../../../src/extensions/browser/main/browser-service'
import { Recorder } from '../../../../src/extensions/browser/main/recorder'
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

function listenSlow(host: string, delayMs: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' })
        response.end('done')
      }, delayMs)
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

async function waitForKeyTargetRef(tab: BrowserTab): Promise<string> {
  const deadline = Date.now() + 10_000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    lastSnapshot = await tab.snapshot()
    const match = lastSnapshot.match(/textbox "KeyTarget" \[ref=(e\d+)\]/)
    if (match) return `@${match[1]}`
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`OOPIF key target ref was not captured:\n${lastSnapshot}`)
}

async function waitForDownloadRef(tab: BrowserTab): Promise<string> {
  const deadline = Date.now() + 10_000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    lastSnapshot = await tab.snapshot()
    const match = lastSnapshot.match(/link "Download" \[ref=(e\d+)\]/)
    if (match) return `@${match[1]}`
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`download ref was not captured:\n${lastSnapshot}`)
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
  let slowServer: Server | undefined
  let downloadServer: Server | undefined
  let downloadClosed = false
  let downloadDir: string | undefined
  let recordingDir: string | undefined
  let recorder: Recorder | undefined
  let window: BrowserWindow | undefined
  let tab: BrowserTab | undefined
  const keepAlive = (): void => {}
  try {
    const testCase = process.env.OOPIF_SCREENSHOT_CASE ?? 'default'
    const targetLeft = testCase === 'offscreen-right' || testCase === 'same-site-offscreen' ? 700 : 30
    const targetTop = testCase === 'offscreen-bottom' ? 1000 : 400
    const targetWidth = testCase === 'oversized' ? 500 : 100
    const childScrollX = testCase === 'offscreen-left' ? 600 : 0
    const childScrollY = testCase === 'offscreen-top' ? 600 : 300
    const rootScrollY = testCase === 'frame-offscreen' ? 0 : 500
    const childHost = testCase === 'same-site-offscreen' ? 'localhost' : '127.0.0.1'
    childServer = await listen(
      childHost,
      () => `<!doctype html><style>
        html,body{margin:0;min-width:1000px;min-height:1200px;background:#ffff00}
        #target{position:absolute;left:${targetLeft}px;top:${targetTop}px;width:${targetWidth}px;height:60px;
          border:0;padding:0;background:#00c800;color:#000}
      </style><button id="target">OOPIF</button>
      <input aria-label="KeyTarget" onkeydown="if(event.key==='Enter') this.value='pressed'">
      <script>scrollTo(${childScrollX},${childScrollY})</script>`
    )
    const childUrl = url(childServer, childHost)
    downloadServer = await new Promise((resolve) => {
      const server = createServer((_request, response) => {
        response.on('close', () => {
          downloadClosed = true
        })
        response.writeHead(200, {
          'content-disposition': 'attachment; filename="large.bin"',
          'content-type': 'application/octet-stream'
        })
        response.write(Buffer.alloc(1024))
        setTimeout(() => response.end(Buffer.alloc(1024)), 5000)
      })
      server.listen(0, 'localhost', () => resolve(server))
    })
    const downloadUrl = url(downloadServer, 'localhost')
    rootServer = await listen(
      'localhost',
      () => `<!doctype html><style>
        html,body{margin:0;min-height:1800px;background:#00ffff}
        iframe{position:absolute;left:150px;top:700px;width:400px;height:300px;
          border:10px solid #c80000;transform:scale(1.25);transform-origin:top left}
      </style><div id="legacy" data-__ab-ci="keep" style="cursor:pointer">Legacy</div>
      <a href="${downloadUrl}">Download</a>
      <iframe src="${childUrl}"></iframe><script>scrollTo(0,${rootScrollY})</script>`
    )
    slowServer = await listenSlow('localhost', 1000)

    await app.whenReady()
    app.on('window-all-closed', keepAlive)
    window = new BrowserWindow({ show: true, x: -2000, y: -2000, width: 900, height: 700 })

    const service = new BrowserService(window)
    const initialWindowCount = BrowserWindow.getAllWindows().length
    const initialClosedListeners = window.listenerCount('closed')
    service.state('unused')
    service.setBounds('unused', { x: 0, y: 0, width: 800, height: 600 })
    service.close('unused', 1)
    if (
      BrowserWindow.getAllWindows().length !== initialWindowCount ||
      window.listenerCount('closed') !== initialClosedListeners
    ) {
      throw new Error('empty browser session allocated native resources')
    }
    service.createTab('used')
    if (window.listenerCount('closed') !== initialClosedListeners + 1) {
      throw new Error('browser session did not register its host cleanup listener')
    }
    await service.destroySession('used')
    if (window.listenerCount('closed') !== initialClosedListeners) {
      throw new Error('destroyed browser session retained its host cleanup listener')
    }
    await service.destroy()
    console.log('PASS BrowserService empty session resources and listener cleanup')

    tab = new BrowserTab(1, `oopif-live-${Date.now()}`)
    window.contentView.addChildView(tab.view)
    tab.view.setBounds({ x: 0, y: 0, width: 900, height: 700 })
    await tab.navigateAndWait(url(rootServer, 'localhost'))

    const ref = await waitForRef(tab)
    const markerState = await tab.evalJs(`() => ({
      legacy: document.querySelector('#legacy').getAttribute('data-__ab-ci'),
      temporary: Array.from(document.querySelectorAll('*')).some((element) =>
        Array.from(element.attributes).some((attribute) =>
          attribute.name.startsWith('data-__larify_cursor_')))
    })`)
    if (
      (markerState as { legacy?: string; temporary?: boolean }).legacy !== 'keep' ||
      (markerState as { legacy?: string; temporary?: boolean }).temporary
    ) {
      throw new Error(`cursor marker cleanup corrupted the page: ${JSON.stringify(markerState)}`)
    }
    const screenshot = await tab.screenshot({ selector: ref, format: 'png' })
    const size = assertGreenCorners(screenshot.data)
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor
    const expected = { width: targetWidth * 1.25 * scaleFactor, height: 75 * scaleFactor }
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
    const keyTarget = await waitForKeyTargetRef(tab)
    await tab.focus(keyTarget)
    await tab.press('Enter')
    const pressedValue = await tab.getValue(keyTarget)
    if (pressedValue !== 'pressed') {
      throw new Error(`OOPIF press did not reach focused input: ${JSON.stringify(pressedValue)}`)
    }
    console.log('PASS BrowserTab OOPIF focused press')

    await tab.evalJs(`() => { void fetch(${JSON.stringify(url(slowServer, 'localhost'))}); return true }`)
    const networkIdleStartedAt = Date.now()
    await tab.waitForLoad('networkidle', 5000)
    const networkIdleElapsed = Date.now() - networkIdleStartedAt
    if (networkIdleElapsed < 900) {
      throw new Error(`networkidle returned before an existing request completed: ${networkIdleElapsed}ms`)
    }
    console.log(`PASS BrowserTab networkidle existing request: ${networkIdleElapsed}ms`)

    recordingDir = await mkdtemp(join(tmpdir(), 'larify-recorder-live-'))
    const recordingPath = join(recordingDir, 'recording.webm')
    recorder = new Recorder()
    await recorder.start(tab, recordingPath)
    await tab.evalJs(`() => {
      let tick = 0
      window.__larifyRecorderTest = setInterval(() => {
        document.body.style.opacity = tick++ % 2 ? '0.99' : '1'
      }, 50)
    }`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const recording = await recorder.stop()
    if (recording.bytes <= 0) throw new Error('recorder produced an empty file')
    console.log(`PASS Recorder output: ${recording.bytes} bytes`)

    const restartStartedAt = Date.now()
    await recorder.start(tab, join(recordingDir, 'recording-restart.webm'))
    const restartElapsed = Date.now() - restartStartedAt
    await new Promise((resolve) => setTimeout(resolve, 500))
    const restartedRecording = await recorder.stop()
    if (restartedRecording.bytes <= 0) throw new Error('restarted recorder produced an empty file')
    if (restartElapsed >= 1000) throw new Error(`recorder repeated its warmup: ${restartElapsed}ms`)
    await recorder.destroy()
    console.log(`PASS Recorder restart without warmup: ${restartedRecording.bytes} bytes`)

    const downloadRef = await waitForDownloadRef(tab)
    downloadDir = await mkdtemp(join(tmpdir(), 'larify-download-destroy-'))
    const download = tab.download(downloadRef, join(downloadDir, 'large.bin'), 10_000)
    await tab.download(downloadRef, join(downloadDir, 'second.bin'), 10_000).then(
      () => {
        throw new Error('concurrent download unexpectedly started')
      },
      (error) => {
        if (!(error instanceof Error) || !error.message.includes('already in progress')) throw error
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    tab.destroy()
    tab = undefined
    await download.then(
      () => {
        throw new Error('download unexpectedly completed before tab destruction')
      },
      (error) => {
        if (!(error instanceof Error) || !error.message.includes('tab was closed during download')) {
          throw error
        }
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (!downloadClosed) throw new Error('destroyed tab did not cancel its active download')
    console.log('PASS BrowserTab active download cancellation')
  } finally {
    await recorder?.destroy()
    tab?.destroy()
    window?.destroy()
    app.removeListener('window-all-closed', keepAlive)
    await Promise.all([
      new Promise<void>((resolve) => childServer?.close(() => resolve()) ?? resolve()),
      new Promise<void>((resolve) => rootServer?.close(() => resolve()) ?? resolve()),
      new Promise<void>((resolve) => slowServer?.close(() => resolve()) ?? resolve()),
      new Promise<void>((resolve) => downloadServer?.close(() => resolve()) ?? resolve())
    ])
    if (downloadDir) await rm(downloadDir, { recursive: true, force: true })
    if (recordingDir) await rm(recordingDir, { recursive: true, force: true })
  }
}

void main().then(
  () => app.exit(0),
  (error) => {
    console.error(error)
    app.exit(1)
  }
)
