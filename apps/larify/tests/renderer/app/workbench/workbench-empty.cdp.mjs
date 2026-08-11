/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json()
)
const target = targets.find(
  ({ type, url }) => type === 'page' && url.startsWith('http://localhost:')
)
if (!target?.webSocketDebuggerUrl) throw new Error(`Larify page not found on port ${port}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})

let commandId = 0
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
    const id = ++commandId
    pending.set(id, { reject, resolve })
    socket.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description)
  return response.result.value
}

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

async function setLauncherWidth(width) {
  const resized = await evaluate(`(() => {
    const empty = document.querySelector('[data-testid="workbench-empty"]')
    if (!empty) return false
    empty.style.width = '${width}px'
    return true
  })()`)
  assert.equal(resized, true, 'workbench launcher should exist')
  await wait(50)
}

async function measure() {
  return evaluate(`(() => {
    const empty = document.querySelector('[data-testid="workbench-empty"]')
    const title = empty?.querySelector('h2')
    const cards = [...(empty?.querySelectorAll('button') ?? [])]
    if (!empty || !title || cards.length === 0) return null
    const emptyRect = empty.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    const cardRects = cards.map((card) => card.getBoundingClientRect())
    const top = Math.min(titleRect.top, ...cardRects.map(({ top }) => top))
    const bottom = Math.max(titleRect.bottom, ...cardRects.map(({ bottom }) => bottom))
    return {
      cardRects: cardRects.map(({ bottom, height, left, right, top, width }) => ({
        bottom, height, left, right, top, width
      })),
      contentCenterY: (top + bottom) / 2,
      empty: {
        bottom: emptyRect.bottom,
        centerX: emptyRect.left + emptyRect.width / 2,
        centerY: emptyRect.top + emptyRect.height / 2,
        left: emptyRect.left,
        right: emptyRect.right,
        width: emptyRect.width
      },
      titleCenterX: titleRect.left + titleRect.width / 2
    }
  })()`)
}

try {
  await evaluate(`document.querySelector('[aria-label="显示工作台"]')?.click()`)
  await wait(350)
  await evaluate(`document.querySelector('.larify-workbench-home')?.click()`)
  await wait(100)
  await evaluate(`(() => {
    const grid = document.querySelector('[data-testid="workbench-empty"] [aria-label="工作台工具"]')
    const card = grid?.querySelector('button')
    if (!grid || !card) return false
    for (let index = 0; index < 5; index += 1) {
      const clone = card.cloneNode(true)
      clone.dataset.responsiveTestCard = String(index)
      grid.append(clone)
    }
    return true
  })()`)

  const results = []
  for (const requestedWidth of [360, 520, 680]) {
    await setLauncherWidth(requestedWidth)
    const layout = await measure()
    assert.ok(layout, `launcher should render at requested width ${requestedWidth}`)
    assert.ok(Math.abs(layout.titleCenterX - layout.empty.centerX) <= 1, 'title should be centered')
    assert.ok(
      Math.abs(layout.contentCenterY - layout.empty.centerY) <= 1,
      'launcher group should be vertically centered'
    )
    for (const card of layout.cardRects) {
      assert.ok(Math.abs(card.width - 88) <= 1, `card width should remain 88px, got ${card.width}`)
      assert.ok(
        Math.abs(card.height - 88) <= 1,
        `card height should remain 88px, got ${card.height}`
      )
      assert.ok(
        card.left >= layout.empty.left && card.right <= layout.empty.right,
        'card should not overflow'
      )
      assert.ok(
        card.top >= 0 && card.bottom <= layout.empty.bottom,
        'card should stay in the viewport'
      )
    }
    results.push({
      cards: layout.cardRects.length,
      columns: new Set(layout.cardRects.map(({ left }) => Math.round(left))).size,
      requestedWidth,
      width: layout.empty.width
    })
  }
  assert.ok(
    new Set(results.map(({ width }) => Math.round(width))).size >= 2,
    'launcher should resize'
  )
  assert.ok(results[0].columns < results.at(-1).columns, 'wider panels should display more columns')

  const overflow = await evaluate(`(() => {
    const empty = document.querySelector('[data-testid="workbench-empty"]')
    const title = empty?.querySelector('h2')
    if (!empty || !title) return null
    empty.style.width = '360px'
    empty.style.height = '180px'
    empty.scrollTop = 0
    const emptyRect = empty.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    return {
      clientHeight: empty.clientHeight,
      scrollHeight: empty.scrollHeight,
      titleTop: titleRect.top,
      viewportTop: emptyRect.top
    }
  })()`)
  assert.ok(overflow, 'launcher should exist for overflow measurement')
  assert.ok(
    overflow.scrollHeight > overflow.clientHeight,
    'launcher should become vertically scrollable'
  )
  assert.ok(
    overflow.titleTop >= overflow.viewportTop,
    'overflowing launcher content should remain reachable from the top'
  )
  console.log(JSON.stringify(results, null, 2))
} finally {
  await evaluate(`(() => {
    document.querySelectorAll('[data-responsive-test-card]').forEach((card) => card.remove())
    const empty = document.querySelector('[data-testid="workbench-empty"]')
    empty?.style.removeProperty('width')
    empty?.style.removeProperty('height')
  })()`)
  socket.close()
}
