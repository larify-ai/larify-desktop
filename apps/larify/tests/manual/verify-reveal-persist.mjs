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

// 带有两个子目录的多文件工作区：external-a/ 与 external-b/
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

  const expandSnapshot = () =>
    evaluate(`(() => ({
      expanded: Array.from(document.querySelectorAll('.workspace-tree [role="treeitem"][aria-expanded="true"]')).map(
        (el) => el.querySelector('.rc-tree-title')?.textContent?.trim()
      ),
      selected: Array.from(document.querySelectorAll('.workspace-tree .rc-tree-node-selected')).map(
        (el) => el.querySelector('.rc-tree-title')?.textContent?.trim()
      )
    }))()`)

  // 外部导航 1：打开 root 目录下的 links.md（目录展开）
  await evaluate(`(() => {
    window.dispatchEvent(new CustomEvent('larify:workbench-open', {
      detail: {
        rendererId: 'workspace',
        options: { root: ${JSON.stringify(root)} },
        onOpen: (resourceId) => {
          window.dispatchEvent(new CustomEvent('larify:workspace-navigation', {
            detail: { path: ${JSON.stringify(root + '\\links2.md')}, resourceId }
          }))
        }
      }
    }))
  })()`)
  await wait(1200)
  console.log('after nav to links2.md =', JSON.stringify(await expandSnapshot()))

  // 外部导航 2：切换到 links.md（同目录，应保持展开）
  await evaluate(`(() => {
    window.dispatchEvent(new CustomEvent('larify:workbench-open', {
      detail: {
        rendererId: 'workspace',
        options: { root: ${JSON.stringify(root)} },
        onOpen: (resourceId) => {
          window.dispatchEvent(new CustomEvent('larify:workspace-navigation', {
            detail: { path: ${JSON.stringify(root + '\\links.md')}, resourceId }
          }))
        }
      }
    }))
  })()`)
  await wait(1200)
  console.log('after nav to links.md =', JSON.stringify(await expandSnapshot()))

  // 树内点击切换（不强制 reveal，不抖动）
  await evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('.workspace-tree [role="treeitem"]')).find(
      (el) => el.querySelector('.rc-tree-title')?.textContent?.trim() === 'links2.md'
    )
    item?.querySelector('.rc-tree-node-content-wrapper')?.click()
  })()`)
  await wait(900)
  console.log('after in-tree click =', JSON.stringify(await expandSnapshot()))
} finally {
  socket.close()
}
