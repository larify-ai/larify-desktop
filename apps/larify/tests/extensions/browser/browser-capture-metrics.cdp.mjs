/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import WebSocket from 'ws'
import { connectLarifyCdp } from '../../manual/cdp-client.mjs'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
const pngSize = (data) => {
  const buffer = Buffer.from(data, 'base64')
  assert.equal(buffer.subarray(1, 4).toString(), 'PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}
const app = await connectLarifyCdp(port)
const existingTargetIds = new Set(
  (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()))
    .map(({ id }) => id)
)
const sessionId = await app.evaluate(
  `document.querySelector('[data-workbench-session][data-active]')?.dataset.workbenchSession`
)
if (!sessionId) throw new Error('Active Larify session not found')

const fixture = resolve('tests/extensions/browser/fixtures/interaction.html')
const resourceId = await app.evaluate(
  `window.bridge.invoke('resource:create', 'browser', ${JSON.stringify(sessionId)}, {})`
)

const connectBrowserTarget = async () => {
  const started = Date.now()
  while (Date.now() - started < 8_000) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
      response.json()
    )
    const target = targets.find(
      ({ id, type, url }) =>
        !existingTargetIds.has(id) &&
        (type === 'page' || type === 'webview') &&
        url.endsWith('interaction.html')
    )
    if (target?.webSocketDebuggerUrl) {
      const socket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolveOpen, reject) => {
        socket.once('open', resolveOpen)
        socket.once('error', reject)
      })
      let nextId = 0
      const pending = new Map()
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw))
        const command = pending.get(message.id)
        if (!command) return
        pending.delete(message.id)
        if (message.error) command.reject(new Error(message.error.message))
        else command.resolve(message.result)
      })
      const send = (method, params = {}) =>
        new Promise((resolveCommand, reject) => {
          const id = ++nextId
          pending.set(id, { resolve: resolveCommand, reject })
          socket.send(JSON.stringify({ id, method, params }))
        })
      return { close: () => socket.close(), send }
    }
    await wait(50)
  }
  throw new Error('Browser fixture target not found')
}

let browser
try {
  await app.evaluate(
    `window.bridge.invoke('browser:navigate', ${JSON.stringify(sessionId)}, ${resourceId}, ${JSON.stringify(fixture)})`
  )
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await app.evaluate(
      `Boolean(document.querySelector('[data-browser-webview-host="${resourceId}"]'))`
    )) break
    await wait(50)
  }
  await app.evaluate(`(() => {
    const host = document.querySelector('[data-browser-webview-host="${resourceId}"]')
    if (!host) throw new Error('Browser WebView host not found')
    host.dataset.browserRendering = 'true'
    host.style.left = '0px'
    host.style.top = '0px'
    host.style.zIndex = '-1'
  })()`)
  browser = await connectBrowserTarget()
  await browser.send('Page.bringToFront')
  await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  const initial = await browser.send('Page.getLayoutMetrics')
  assert.ok(initial.cssContentSize?.width > 0)
  assert.ok(initial.cssContentSize?.height > 0)
  assert.ok(initial.cssVisualViewport?.clientWidth > 0)
  assert.ok(initial.cssVisualViewport?.clientHeight > 0)
  const viewportCapture = await browser.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: {
      x: initial.cssVisualViewport.pageX,
      y: initial.cssVisualViewport.pageY,
      width: initial.cssVisualViewport.clientWidth,
      height: initial.cssVisualViewport.clientHeight,
      scale: 1
    },
    captureBeyondViewport: false
  })

  await browser.send('Runtime.evaluate', {
    expression: `document.body.style.minHeight = '2400px'`
  })
  let metrics
  for (let attempt = 0; attempt < 80; attempt++) {
    metrics = await browser.send('Page.getLayoutMetrics')
    if (metrics.cssContentSize?.height >= 2400) break
    await wait(50)
  }
  const size = metrics?.cssContentSize
  assert.ok(size?.width > 0)
  assert.ok(size?.height >= 2400)
  const fullPageCapture = await browser.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
    captureBeyondViewport: true
  })
  const viewportImage = pngSize(viewportCapture.data)
  const fullPageImage = pngSize(fullPageCapture.data)
  assert.ok(fullPageImage.height > viewportImage.height)
  console.log(JSON.stringify({
    initial: initial.cssContentSize,
    viewport: initial.cssVisualViewport,
    fullPage: size,
    viewportImage,
    fullPageImage
  }))
} finally {
  await browser?.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {})
  browser?.close()
  await app.evaluate(`(() => {
    const host = document.querySelector('[data-browser-webview-host="${resourceId}"]')
    if (!host) return
    delete host.dataset.browserRendering
    host.style.left = '-10000px'
    host.style.top = '-10000px'
    host.style.zIndex = ''
  })()`).catch(() => {})
  await app.evaluate(`window.bridge.invoke('resource:close', ${resourceId})`).catch(() => {})
  app.close()
}
