/* eslint-disable @typescript-eslint/explicit-function-return-type */
import WebSocket from 'ws'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const targets = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const appTarget = targets.find(
  ({ type, url }) => type === 'page' && url.startsWith('http://localhost:')
)
const pdfTargets = targets.filter(({ type, url }) => type === 'page' && url.endsWith('.pdf'))
const viewerTarget = targets.find(
  ({ type, url }) =>
    type === 'webview' && url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')
)
if (!appTarget || pdfTargets.length === 0) throw new Error('App or PDF CDP target not found')

const connect = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  let id = 0
  const pending = new Map()
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    message.error ? request.reject(message.error) : request.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id
      pending.set(requestId, { resolve, reject })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    return result.result.value
  }
  return { close: () => socket.close(), evaluate, send }
}

const app = await connect(appTarget)
const pdfTargetsConnected = await Promise.all(pdfTargets.map(connect))
const viewer = viewerTarget ? await connect(viewerTarget) : null
try {
  if (process.env.INSPECT_SCROLL) {
    const geometry = await app.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="native-file-preview"]')?.getBoundingClientRect()
      const sash = Array.from(document.querySelectorAll('.sash')).find((item) => {
        const rect = item.getBoundingClientRect()
        return item.parentElement?.parentElement?.classList.contains('larify-workbench-allotment') && rect.height > 400 && rect.width < 20
      })?.getBoundingClientRect()
      return preview && sash && {
        previewWidth: preview.width,
        sash: { x: sash.x + sash.width / 2, y: sash.y + sash.height / 2 }
      }
    })()`)
    const targetWidth = Number(process.env.INSPECT_SCROLL_WIDTH ?? 420)
    const delta = geometry ? geometry.previewWidth - targetWidth : 0
    if (geometry && Math.abs(delta) > 1) {
      await app.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...geometry.sash,
        button: 'left',
        buttons: 1,
        clickCount: 1
      })
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: geometry.sash.x + delta,
        y: geometry.sash.y,
        button: 'left',
        buttons: 1
      })
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: geometry.sash.x + delta,
        y: geometry.sash.y,
        button: 'left',
        buttons: 0,
        clickCount: 1
      })
      await wait(300)
    }
    console.log(
      JSON.stringify(
        await (viewer ?? pdfTargetsConnected[0]).evaluate(`(() => {
          const scrollables = []
          const visit = (root, path = '') => {
            for (const element of root.querySelectorAll('*')) {
              const nextPath = path + '/' + element.localName + (element.id ? '#' + element.id : '')
              if (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight) {
                const style = getComputedStyle(element)
                scrollables.push({
                  path: nextPath,
                  clientWidth: element.clientWidth,
                  scrollWidth: element.scrollWidth,
                  clientHeight: element.clientHeight,
                  scrollHeight: element.scrollHeight,
                  overflowX: style.overflowX,
                  overflowY: style.overflowY
                })
              }
              if (element.shadowRoot) visit(element.shadowRoot, nextPath + '::shadow')
            }
          }
          visit(document)
          return ({
          innerWidth,
          innerHeight,
          document: {
            clientWidth: document.documentElement.clientWidth,
            clientHeight: document.documentElement.clientHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            overflowX: getComputedStyle(document.documentElement).overflowX,
            overflowY: getComputedStyle(document.documentElement).overflowY
          },
          body: document.body && {
            clientWidth: document.body.clientWidth,
            clientHeight: document.body.clientHeight,
            scrollWidth: document.body.scrollWidth,
            scrollHeight: document.body.scrollHeight,
            overflowX: getComputedStyle(document.body).overflowX,
            overflowY: getComputedStyle(document.body).overflowY
          },
          scrollables
        })})()`),
        null,
        2
      )
    )
    if (geometry && Math.abs(delta) > 1) {
      await app.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: geometry.sash.x + delta,
        y: geometry.sash.y,
        button: 'left',
        buttons: 1,
        clickCount: 1
      })
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...geometry.sash,
        button: 'left',
        buttons: 1
      })
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...geometry.sash,
        button: 'left',
        buttons: 0,
        clickCount: 1
      })
    }
    process.exit(0)
  }
  const sash = await app.evaluate(`(() => {
    const element = Array.from(document.querySelectorAll('.sash')).find((item) => {
      const rect = item.getBoundingClientRect()
      return item.parentElement?.parentElement?.classList.contains('larify-workbench-allotment') && rect.height > 400 && rect.width < 20
    })
    const rect = element?.getBoundingClientRect()
    return rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })()`)
  if (!sash) throw new Error('Workbench sash not found')
  const samples = []
  await app.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...sash,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  for (let step = 1; step <= 12; step += 1) {
    const point = { x: sash.x + step * 8, y: sash.y }
    await app.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...point,
      button: 'left',
      buttons: 1
    })
    const immediate = await Promise.all([
      app.evaluate(
        `document.querySelector('[data-testid="native-file-preview"]')?.getBoundingClientRect().width`
      ),
      Promise.all(pdfTargetsConnected.map((pdf) => pdf.evaluate('innerWidth')))
    ])
    await wait(16)
    const afterFrame = await Promise.all(
      pdfTargetsConnected.map((pdf) => pdf.evaluate('innerWidth'))
    )
    samples.push({
      step,
      dom: immediate[0],
      nativeImmediate: immediate[1],
      nativeAfterFrame: afterFrame
    })
  }
  await app.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: sash.x + 96,
    y: sash.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
  console.log(JSON.stringify(samples, null, 2))
  await app.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: sash.x + 96,
    y: sash.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await app.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...sash,
    button: 'left',
    buttons: 1
  })
  await app.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...sash,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
} finally {
  app.close()
  pdfTargetsConnected.forEach((pdf) => pdf.close())
  viewer?.close()
}
