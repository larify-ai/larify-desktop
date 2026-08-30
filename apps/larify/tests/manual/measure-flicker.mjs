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
  const sessionId = await evaluate(`(() => {
    const active = document.querySelector('[data-workbench-session][data-active]')?.getAttribute('data-workbench-session')
    return active ?? Array.from(document.querySelectorAll('[data-session-id]'))[0]?.getAttribute('data-session-id')
  })()`)
  await evaluate(`(() => {
    window.dispatchEvent(new CustomEvent('larify:workbench-open', {
      detail: { rendererId: 'workspace', options: { root: ${JSON.stringify(root)} } }
    }))
  })()`)
  await wait(2500)

  // 注入 MutationObserver：记录 workspace-markdown-preview 内容空帧
  await evaluate(`(() => {
    window.__flickerEvents = []
    const record = (type, detail) => window.__flickerEvents.push({ t: performance.now(), type, detail })
    const collect = () => {
      const preview = document.querySelector('.workspace-markdown-preview')
      if (!preview) { record('no-preview', ''); return }
      const text = preview.textContent?.trim() ?? ''
      if (preview.childElementCount === 0 && !text) record('empty-preview', '')
    }
    collect()
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList' && m.target instanceof Element && m.target.closest('.workspace-markdown-preview')) collect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    window.__flickerTreeObserver = observer
  })()`)

  // 依次点击树中两个 md 文件 3 轮
  for (let round = 0; round < 3; round += 1) {
    for (const name of ['links.md', 'links2.md']) {
      const clicked = await evaluate(`(() => {
        const item = Array.from(document.querySelectorAll('.workspace-tree [role="treeitem"]')).find(
          (el) => el.querySelector('.rc-tree-title')?.textContent?.trim() === ${JSON.stringify(name)}
        )
        item?.querySelector('.rc-tree-node-content-wrapper')?.click()
        return Boolean(item?.querySelector('.rc-tree-node-content-wrapper'))
      })()`)
      if (!clicked) console.log('MISS', name)
      await wait(1000)
    }
  }

  const events = await evaluate(`(() => {
    window.__flickerTreeObserver?.disconnect()
    const events = window.__flickerEvents ?? []
    window.__flickerEvents = []
    return events
  })()`)
  console.log('empty-preview events =', JSON.stringify(events.filter((e) => e.type !== 'no-preview')))
  console.log('no-preview events =', events.filter((e) => e.type === 'no-preview').length)
  console.log('total flicker =', events.length)
} finally {
  socket.close()
}
