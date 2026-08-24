/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import WebSocket from 'ws'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json()
)
const target = targets.find(
  ({ type, url }) =>
    type === 'page' &&
    (url.startsWith('http://localhost:') || url.endsWith('/out/renderer/index.html'))
)
if (!target?.webSocketDebuggerUrl) throw new Error(`Larify page not found on port ${port}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
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
  if (message.error) command.reject(new Error(message.error.message))
  else command.resolve(message.result)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const commandId = ++id
    pending.set(commandId, { resolve, reject })
    socket.send(JSON.stringify({ id: commandId, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description)
  return result.result.value
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitFor = async (expression, label, timeout = 8_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}
const connectPage = async (urlPart) => {
  const started = Date.now()
  let target
  while (Date.now() - started < 8_000) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
      response.json()
    )
    target = list.find(
      ({ type, url }) => (type === 'page' || type === 'webview') && url.includes(urlPart)
    )
    if (target) break
    await wait(50)
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`Browser page not found: ${urlPart}`)
  const pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    pageSocket.once('open', resolveOpen)
    pageSocket.once('error', reject)
  })
  let pageId = 0
  const pagePending = new Map()
  pageSocket.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    const command = pagePending.get(message.id)
    if (!command) return
    pagePending.delete(message.id)
    command.resolve(message.result)
  })
  const pageSend = (method, params = {}) =>
    new Promise((resolveCommand) => {
      const commandId = ++pageId
      pagePending.set(commandId, { resolve: resolveCommand })
      pageSocket.send(JSON.stringify({ id: commandId, method, params }))
    })
  const pageEvaluate = async (expression) => {
    const result = await pageSend('Runtime.evaluate', { expression, returnByValue: true })
    return result.result.value
  }
  const pageWaitFor = async (expression, label) => {
    const waitStarted = Date.now()
    while (Date.now() - waitStarted < 8_000) {
      try {
        const value = await pageEvaluate(expression)
        if (value) return value
      } catch {
        // The renderer may be replaced while the page is reloading.
      }
      await wait(50)
    }
    throw new Error(`Timed out: ${label}`)
  }
  return { socket: pageSocket, send: pageSend, evaluate: pageEvaluate, waitFor: pageWaitFor }
}
const openLauncher = async () => {
  if (await evaluate(`Boolean(document.querySelector('[data-testid="workbench-empty"]'))`)) return
  await evaluate(`document.querySelector('.larify-workbench-home')?.click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="workbench-empty"]'))`, 'launcher')
}
const createBrowser = async () => {
  await openLauncher()
  const before = await evaluate(`window.bridge.invoke('resource:list')`)
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-testid="workbench-empty"] button')]
      .find((element) => element.textContent.trim() === '浏览器')
    button?.click()
    return Boolean(button)
  })()`)
  assert.equal(clicked, true)
  const resources = await waitFor(
    `(async () => {
      const resources = await window.bridge.invoke('resource:list')
      return resources.length > ${before.length} ? resources : null
    })()`,
    'browser resource'
  )
  return resources.find(({ id }) => !before.some((resource) => resource.id === id))
}
const selectTab = async (resourceId, title) => {
  const clicked = await evaluate(`(() => {
    const view = document.querySelector('[data-resource-id="${resourceId}"]')
    const tab = document.querySelector('[data-tab-id="' + view?.dataset.viewId + '"]')
    const trigger = tab?.querySelector('.larify-workbench-tab-trigger')
    trigger?.click()
    return Boolean(trigger)
  })()`)
  assert.equal(clicked, true, `tab not found: ${title}`)
  await waitFor(
    `(() => {
      const view = document.querySelector('[data-resource-id="${resourceId}"]')
      const tab = document.querySelector('[data-tab-id="' + view?.dataset.viewId + '"]')
      return tab?.querySelector('.larify-workbench-tab-trigger')?.getAttribute('data-state') === 'active'
    })()`,
    `active tab ${title}`
  )
}
const navigateBrowser = (resource, url) =>
  evaluate(
    `window.bridge.invoke('browser:navigate', ${JSON.stringify(resource.sessionId)}, ${resource.id}, ${JSON.stringify(url)})`
  )
const created = []
try {
  const first = await createBrowser()
  created.push(first.id)
  assert.equal(first.type, 'browser')
  await waitFor(
    `document.querySelector('.larify-workbench-tab-trigger[data-state="active"] .larify-workbench-tab-title')?.textContent === '新标签页'`,
    'blank browser title'
  )
  const title = 'Example Domain'
  const url = 'https://example.com/'
  await evaluate(
    `window.bridge.invoke('browser:navigate', ${JSON.stringify(first.sessionId)}, ${first.id}, 'not a valid url')`
  )
  await waitFor(
    `(async () => {
      const value = (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.url
      if (!value) return false
      const url = new URL(value)
      return url.hostname.endsWith('bing.com') && url.pathname === '/search' && url.searchParams.get('q') === 'not a valid url'
    })()`,
    'address search'
  )
  await navigateBrowser(first, url)
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.title === ${JSON.stringify(title)})()`,
    'browser title'
  )
  await waitFor(
    `document.querySelector('.larify-workbench-tab-trigger[data-state="active"] .larify-workbench-tab-title')?.textContent === ${JSON.stringify(title)}`,
    'workbench title'
  )
  assert.equal(
    await evaluate(
      `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.url)()`
    ),
    url
  )

  const secondUrl = 'https://example.com/?history=second'
  await navigateBrowser(first, secondUrl)
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.url === ${JSON.stringify(secondUrl)})()`,
    'second address navigation'
  )
  await evaluate(
    `window.bridge.invoke('browser:back', ${JSON.stringify(first.sessionId)}, ${first.id})`
  )
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.url === ${JSON.stringify(url)})()`,
    'browser back'
  )
  await evaluate(
    `window.bridge.invoke('browser:forward', ${JSON.stringify(first.sessionId)}, ${first.id})`
  )
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.url === ${JSON.stringify(secondUrl)})()`,
    'browser forward'
  )
  await evaluate(
    `window.bridge.invoke('browser:reload', ${JSON.stringify(first.sessionId)}, ${first.id})`
  )
  await waitFor(
    `(async () => !(await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.loading)()`,
    'browser reload'
  )

  const fixturePath = resolve('tests/extensions/browser/fixtures/interaction.html')
  await navigateBrowser(first, fixturePath)
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.title === 'Browser Interaction Test')()`,
    'interaction fixture'
  )
  const page = await connectPage('interaction.html')
  const pageClick = async (selector) => {
    const position = await page.evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect()
      return rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })()`)
    assert.ok(position, `page element not found: ${selector}`)
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: position.x,
      y: position.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: position.x,
      y: position.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
  }
  await pageClick('#text')
  await page.send('Input.insertText', { text: 'Larify browser input' })
  assert.equal(await page.evaluate(`document.querySelector('#text').value`), 'Larify browser input')

  await pageClick('#increment')
  assert.equal(await page.evaluate(`document.querySelector('#count').value`), '1')
  await pageClick('#dialog')
  assert.equal(await page.evaluate(`document.querySelector('#dialog-result').value`), 'continued')

  const beforePopup = await evaluate(`window.bridge.invoke('resource:list', { type: 'browser' })`)
  await pageClick('#popup')
  const popupResources = await waitFor(
    `(async () => {
      const resources = await window.bridge.invoke('resource:list', { type: 'browser' })
      return resources.length > ${beforePopup.length} ? resources : null
    })()`,
    'popup browser resource'
  )
  const popup = popupResources.find(({ id }) => !beforePopup.some((resource) => resource.id === id))
  assert.ok(popup)
  created.push(popup.id)
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(popup.sessionId)}, ${popup.id}))?.title === 'Browser Interaction Next')()`,
    'popup browser title'
  )
  await evaluate(`window.bridge.invoke('resource:close', ${popup.id})`)
  await waitFor(
    `(async () => !(await window.bridge.invoke('resource:list')).some(({ id }) => id === ${popup.id}))()`,
    'popup browser close'
  )
  created.splice(created.indexOf(popup.id), 1)

  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 200,
    y: 200,
    deltaX: 0,
    deltaY: 600
  })
  await page.waitFor('scrollY > 0', 'page scroll')
  await page.evaluate('scrollTo(0, 0)')
  await pageClick('#next')
  await page.waitFor(`document.title === 'Browser Interaction Next'`, 'page link navigation')
  await waitFor(
    `document.querySelector('.larify-workbench-tab-trigger[data-state="active"] .larify-workbench-tab-title')?.textContent === 'Browser Interaction Next'`,
    'linked page tab title'
  )
  page.socket.close()
  await evaluate(
    `window.bridge.invoke('browser:back', ${JSON.stringify(first.sessionId)}, ${first.id})`
  )
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.title === 'Browser Interaction Test')()`,
    'back to interaction fixture'
  )
  await evaluate(
    `window.bridge.invoke('browser:back', ${JSON.stringify(first.sessionId)}, ${first.id})`
  )
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.url === ${JSON.stringify(secondUrl)})()`,
    'back to remote page'
  )

  await navigateBrowser(first, 'http://127.0.0.1:1/')
  await waitFor(
    `(async () => Boolean((await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.error))()`,
    'failed navigation state'
  )
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.loading === false)()`,
    'failed navigation stopped loading'
  )
  await navigateBrowser(first, secondUrl)
  await waitFor(
    `(async () => {
      const state = await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id})
      return state?.url === ${JSON.stringify(secondUrl)} && state.error === null
    })()`,
    'navigation recovery'
  )

  const second = await createBrowser()
  created.push(second.id)
  await waitFor(
    `document.querySelector('.larify-workbench-tab-trigger[data-state="active"] .larify-workbench-tab-title')?.textContent === '新标签页'`,
    'second blank browser title'
  )
  const secondTitle = await evaluate(
    `document.querySelector('.larify-workbench-tab-trigger[data-state="active"] .larify-workbench-tab-title')?.textContent`
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-browser-webview-host="${second.id}"]')?.style.left`
    ),
    '-10000px',
    'an active blank webview must not cover the empty state'
  )
  assert.equal(
    await evaluate(
      `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(second.sessionId)}, ${second.id}))?.id)()`
    ),
    second.id
  )
  await evaluate(`(() => {
    const host = document.querySelector('[data-browser-webview-host="${first.id}"]')
    host.dataset.browserRendering = 'true'
    host.style.left = '0px'
    host.style.top = '0px'
    host.style.zIndex = '-1'
  })()`)
  const stagedBounds = await evaluate(`(() => {
    const host = document.querySelector('[data-browser-webview-host="${first.id}"]')
    const { x, y, width, height } = host.getBoundingClientRect()
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new CustomEvent('larify:native-layout'))
    const next = host.getBoundingClientRect()
    return { before: { x, y, width, height }, after: { x: next.x, y: next.y, width: next.width, height: next.height } }
  })()`)
  assert.deepEqual(
    stagedBounds.after,
    stagedBounds.before,
    'user layout must not resize a leased webview'
  )
  const hiddenPage = await connectPage('history=second')
  await hiddenPage.send('Page.bringToFront')
  await hiddenPage.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await hiddenPage.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false
  })
  assert.equal(
    (
      await hiddenPage.send('Runtime.evaluate', {
        expression: 'innerWidth === 640 && innerHeight === 480',
        returnByValue: true
      })
    ).result.value,
    true,
    'Agent CDP must still be able to resize the guest viewport'
  )
  const hiddenCapture = await hiddenPage.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })
  assert.ok(
    hiddenCapture.data.length > 1_000,
    'hidden webview screenshot should contain image data'
  )
  await hiddenPage.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await hiddenPage.send('Emulation.clearDeviceMetricsOverride')
  hiddenPage.socket.close()
  await evaluate(`(() => {
    const host = document.querySelector('[data-browser-webview-host="${first.id}"]')
    delete host.dataset.browserRendering
    host.style.left = '-10000px'
    host.style.top = '-10000px'
    host.style.zIndex = ''
  })()`)
  const browserResources = await evaluate(
    `window.bridge.invoke('resource:list', { type: 'browser' })`
  )
  assert.ok(browserResources.some(({ id }) => id === first.id))
  assert.ok(browserResources.some(({ id }) => id === second.id))
  assert.equal(
    await evaluate(
      `document.querySelectorAll('[data-workbench-session][data-active] .larify-workbench-tabs').length`
    ),
    1
  )

  await selectTab(first.id, title)
  await waitFor(
    `(async () => (await window.bridge.invoke('browser:getState', ${JSON.stringify(first.sessionId)}, ${first.id}))?.id === ${first.id})()`,
    'first browser active'
  )

  await evaluate(`document.querySelector('.larify-workbench-home')?.click()`)
  await waitFor(`Boolean(document.querySelector('[data-testid="workbench-empty"]'))`, 'launcher')
  await selectTab(first.id, title)

  const sash = await evaluate(`(() => {
    const rect = document.querySelector('.larify-allotment > .sash-container > .sash')?.getBoundingClientRect()
    return rect ? { x: rect.x, y: rect.y + rect.height / 2 } : null
  })()`)
  assert.ok(sash)
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: sash.x,
    y: sash.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: sash.x - 80,
    y: sash.y,
    button: 'left',
    buttons: 1
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: sash.x - 80,
    y: sash.y,
    button: 'left',
    buttons: 0
  })
  assert.equal(
    await evaluate(
      `document.querySelector('[data-browser-webview-host="${first.id}"] webview')?.getBoundingClientRect().width > 0`
    ),
    true
  )

  await selectTab(second.id, secondTitle)
  await waitFor(
    `(() => {
      const view = document.querySelector('[data-resource-id="${second.id}"]')
      const tab = document.querySelector('[data-tab-id="' + view?.dataset.viewId + '"]')
      return tab?.querySelector('.larify-workbench-tab-trigger')?.getAttribute('data-state') === 'active'
    })()`,
    'second browser tab active'
  )
  await wait(50)
  assert.equal(
    await evaluate(`(() => {
      const view = document.querySelector('[data-resource-id="${second.id}"]')
      const tab = document.querySelector('[data-tab-id="' + view?.dataset.viewId + '"]')
      const close = tab?.querySelector('.larify-workbench-tab-close')
      close?.click()
      return Boolean(close)
    })()`),
    true,
    'second browser close button not found'
  )
  await waitFor(
    `(async () => !(await window.bridge.invoke('resource:list')).some(({ id }) => id === ${second.id}))()`,
    'browser close'
  )
  created.splice(created.indexOf(second.id), 1)
  console.log(
    JSON.stringify({
      dialogs: 'passed',
      failures: 'passed',
      interactions: 'passed',
      popups: 'passed',
      resourcesCreated: 2,
      resized: true,
      switching: 'passed',
      title
    })
  )
} finally {
  for (const resourceId of created)
    await evaluate(`window.bridge.invoke('resource:close', ${resourceId})`)
  socket.close()
}
