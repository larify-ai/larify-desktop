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

const root = 'C:\\Users\\hylnb\\.larify\\workspace\\__white-repro__'

try {
  await send('Page.reload', { ignoreCache: true })
  await wait(2500)
  await evaluate(`document.querySelector('button[aria-label="显示工作台"]')?.click()`)
  await wait(600)
  await evaluate(`(() => {
    window.dispatchEvent(new CustomEvent('larify:workbench-open', {
      detail: { rendererId: 'workspace', options: { root: ${JSON.stringify(root)} } }
    }))
  })()`)
  await wait(2500)
  const clicked = await evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('.workspace-tree [role="treeitem"]')).find(
      (el) => el.querySelector('.rc-tree-title')?.textContent?.trim() === 'links.md'
    )
    item?.querySelector('.rc-tree-node-content-wrapper')?.click()
    return Boolean(item)
  })()`)
  await wait(1500)

  const state = await evaluate(`(() => {
    const preview = document.querySelector('.workspace-markdown-preview')
    const headings = Array.from(preview?.querySelectorAll('h1, h2') ?? []).map((h) => ({
      id: h.getAttribute('id'),
      text: h.textContent?.trim().slice(0, 20)
    }))
    const anchor = Array.from(preview?.querySelectorAll('.larify-message-link') ?? []).find((el) => el.textContent === 'anchor')
    const h2 = Array.from(preview?.querySelectorAll('h2') ?? []).find((el) => el.getAttribute('id') === 'section-2')
    return { headings, hasAnchor: Boolean(anchor), targetScrollable: Boolean(h2) }
  })()`)
  console.log('headings =', JSON.stringify(state, null, 2))

  // 点击 anchor，观察 scrollTop 变化
  const before = await evaluate(`(() => {
    const preview = document.querySelector('.workspace-markdown-preview')
    preview.scrollTop = 0
    return preview.scrollTop
  })()`)
  await evaluate(`(() => {
    const preview = document.querySelector('.workspace-markdown-preview')
    const anchor = Array.from(preview.querySelectorAll('.larify-message-link')).find((el) => el.textContent === 'anchor')
    anchor?.click()
  })()`)
  await wait(800)
  const after = await evaluate(`(() => {
    const preview = document.querySelector('.workspace-markdown-preview')
    return { scrollTop: preview.scrollTop, scrollHeight: preview.scrollHeight, clientHeight: preview.clientHeight }
  })()`)
  console.log('scroll before =', before, 'after =', JSON.stringify(after))
  console.log('anchor scroll works =', after.scrollTop > 0 || after.scrollHeight <= after.clientHeight)
} finally {
  socket.close()
}
