/* eslint-disable @typescript-eslint/explicit-function-return-type */
import WebSocket from 'ws'

const targets = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const appTarget = targets.find(
  ({ type, url }) => type === 'page' && url.startsWith('http://localhost:')
)
const pdfTarget = targets.find(({ type, url }) => type === 'page' && url.endsWith('.pdf'))
if (!appTarget || !pdfTarget) throw new Error('App or PDF CDP target not found')

const connect = async (url) => {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  let id = 0
  const pending = new Map()
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    const command = pending.get(message.id)
    if (!command) return
    pending.delete(message.id)
    message.error ? command.reject(message.error) : command.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id
      pending.set(next, { reject, resolve })
      socket.send(JSON.stringify({ id: next, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true
    })
    return result.result.value
  }
  return { close: () => socket.close(), evaluate }
}

const app = await connect(appTarget.webSocketDebuggerUrl)
const pdf = await connect(pdfTarget.webSocketDebuggerUrl)

try {
  await pdf.evaluate(`(() => {
    window.__toggleProbe = { resizeEvents: 0, samples: [] }
    window.addEventListener('resize', () => window.__toggleProbe.resizeEvents += 1)
    const started = performance.now()
    const capture = () => {
      window.__toggleProbe.samples.push({
        t: Math.round(performance.now() - started),
        width: innerWidth,
        visualWidth: visualViewport?.width
      })
      if (performance.now() - started < 800) requestAnimationFrame(capture)
    }
    requestAnimationFrame(capture)
  })()`)
  await app.evaluate(`document.querySelector('button[aria-label="隐藏工作台"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await app.evaluate(`document.querySelector('button[aria-label="显示工作台"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  console.log(JSON.stringify(await pdf.evaluate('window.__toggleProbe'), null, 2))
} finally {
  app.close()
  pdf.close()
}
