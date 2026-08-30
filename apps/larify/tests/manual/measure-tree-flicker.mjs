/* eslint-disable */
import WebSocket from 'ws'

const port = '9333'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find(
  (t) => t.type === 'page'
)
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  socket.once('open', res)
  socket.once('error', rej)
})
let nextId = 0
const pending = new Map()
socket.on('message', (raw) => {
  const message = JSON.parse(String(raw))
  const command = pending.get(message.id)
  if (!command) return
  pending.delete(message.id)
  message.error ? command.reject(new Error(message.error.message)) : command.resolve(message.result)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

try {
  // 注入树状态观察
  await evaluate(`(() => {
    window.__treeEvents = []
    const tree = document.querySelector('.workspace-tree')
    const record = (type, detail) => window.__treeEvents.push({ t: performance.now(), type, detail })
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const el = m.target
        if (el instanceof Element && el.matches('.workspace-tree') && m.type === 'attributes') {
          record('tree-changed', el.className?.slice(0, 40))
        }
        if (el instanceof Element && el.hasAttribute('aria-expanded') && m.type === 'attributes') {
          record('expand', el.getAttribute('aria-expanded'))
        }
        if (el instanceof Element && el.closest('.workspace-tree') && m.type === 'childList') {
          record('childlist', el.tagName)
        }
      }
    })
    observer.observe(tree, { subtree: true, attributes: true, childList: true, attributeFilter: ['aria-expanded', 'class'] })
    window.__treeObserver = observer
    return Boolean(tree)
  })()`)

  // 切 4 次文件
  for (const name of ['links.md', 'links2.md', 'links.md', 'links2.md']) {
    await evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.workspace-tree [role="treeitem"]')).find(
        (el) => el.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(name)}
      )
      item?.querySelector('.rc-tree-node-content-wrapper')?.click()
    })()`)
    await wait(900)
  }

  const events = await evaluate(`(() => {
    window.__treeObserver?.disconnect()
    const events = window.__treeEvents ?? []
    window.__treeEvents = []
    return events
  })()`)
  console.log('tree events =', JSON.stringify(events.slice(0, 40), null, 2))
  console.log('total =', events.length)
} finally {
  socket.close()
}
