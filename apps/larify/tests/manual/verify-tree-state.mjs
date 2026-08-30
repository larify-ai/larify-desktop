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

const snap = () =>
  evaluate(`(() => ({
    tree: Boolean(document.querySelector('.workspace-tree')),
    expanded: Array.from(document.querySelectorAll('.workspace-tree [role="treeitem"][aria-expanded="true"]')).map(
      (el) => el.querySelector('.rc-tree-title')?.textContent?.trim()
    ),
    selected: Array.from(document.querySelectorAll('.workspace-tree .rc-tree-node-selected')).map(
      (el) => el.querySelector('.rc-tree-title')?.textContent?.trim()
    ),
    previewText: (document.querySelector('.workspace-markdown-preview')?.textContent ?? '').slice(0, 40)
  }))()`)

console.log('before =', JSON.stringify(await snap()))
for (const name of ['links2.md', 'links.md']) {
  await evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('.workspace-tree [role="treeitem"]')).find(
      (el) => el.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(name)}
    )
    item?.querySelector('.rc-tree-node-content-wrapper')?.click()
    return Boolean(item)
  })()`)
  await wait(900)
  console.log('after', name, '=', JSON.stringify(await snap()))
}
socket.close()
