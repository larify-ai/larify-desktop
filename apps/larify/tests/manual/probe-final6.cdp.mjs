/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'
const wait = (t) => new Promise(r => setTimeout(r, t))
const app = await connectLarifyCdp()
console.log('[CDP] connected')
await app.send('Runtime.enable')

const errors = []
app.onEvent(msg => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push('[EX] ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('[ERR] ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '))
})

const run = async (expr, label) => {
  console.log('\n→ ' + label)
  const r = await app.evaluate(`Promise.resolve().then(() => { ${expr} })`)
  console.log('  =', JSON.stringify(r).slice(0, 900))
  return r
}

// Step 0: 点左侧 workspace 导航（workspace 类型 item：第 3 个按钮"larify-desktop"或"默认空间"）
await run(`
  const btns = Array.from(document.querySelectorAll('button.mx-1'))
  // 点击 textContent 里是 workspace 名（第 3 个或"默认空间"）
  const workspaceBtn = btns.find(b => /larify-desktop|默认空间|Workspace|工作空间$/.test(b.textContent ?? '')) || btns[3]
  if (workspaceBtn) workspaceBtn.click()
  return { clicked: workspaceBtn ? workspaceBtn.textContent?.trim().slice(0, 50) : null }
`, '0. 点击左侧 workspace 导航（larify-desktop）')
await wait(800)

// Step 1: 看有没有 preview
const p1 = await run(`
  const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
  const preview = document.querySelector('.workspace-markdown-preview')
  if (!preview) return { workspaceCount: count, noPreview: true }
  const links = Array.from(preview.querySelectorAll('button.larify-message-link, a.larify-message-link'))
  return {
    workspaceCount: count,
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 50), href: l.getAttribute('href') })),
  }
`, '1. 链接列表（检查是否变成了 button）')

// Step 2: 点击第一个链接
const c1 = await run(`
  const preview = document.querySelector('.workspace-markdown-preview')
  if (!preview) return '__no_preview__'
  const links = Array.from(preview.querySelectorAll('button.larify-message-link, a.larify-message-link'))
  const l = links[0]
  if (!l) return '__no_link__'
  l.click()
  return { tag: l.tagName, text: l.textContent?.trim().slice(0, 50) }
`, '2. 点击第一个链接')
await wait(2500)

// Step 3: 结果
const post = await run(`
  const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
  const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim())
  const selected = Array.from(document.querySelectorAll('[role="treeitem"].rc-tree-node-selected .rc-tree-title')).map(t => t.textContent?.trim())
  return { workspaceCountAfter: count, tabTitles: tabs.slice(-8), selectedTreeTitles: selected }
`, '3. 点击后结果（workspace 数 / tab 标题 / 树选中项）')

console.log('\n=== Runtime errors (last 5):')
for (const e of errors.slice(-5)) console.log(' ', e.slice(0, 500))
process.exit(0)
