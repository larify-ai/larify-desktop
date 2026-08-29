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
  console.log('  =', JSON.stringify(r).slice(0, 1500))
  return r
}

// 0. 用 workspace manager (id=1 或 resource:list 返回的根目录) 列出根目录下所有 md 和递归找到"链接跳转测试"并新开 workbench
const pre = await run(`
  const list = await window.bridge.invoke('resource:list')
  const ws = list.find(r => r.type === 'workspace')
  const id = ws?.id ?? 1
  const res = await window.bridge.invoke('workspace:list', id)
  const { entries, root } = res
  // 递归找 md
  const mdFiles = []
  const stack = [{ entries, dir: '' }]
  const MAX = 2000
  let checks = 0
  while (stack.length && checks < MAX) {
    const { entries } = stack.shift()
    for (const e of entries) {
      checks++
      if (e.name?.toLowerCase().endsWith('.md')) {
        mdFiles.push({ name: e.name, path: e.path, match: /链接跳转|link/i.test(e.name) })
      }
      if (e.type === 'directory' || e.kind === 'directory' || e.children?.length || (!e.name?.includes('.') && e.children)) {
        try {
          const sub = await window.bridge.invoke('workspace:list', id, e.path ?? (root + '/' + e.name))
          if (sub?.entries) stack.push({ entries: sub.entries })
        } catch (_) {}
      }
    }
  }
  return { workspaceId: id, root, mdCount: mdFiles.length, matches: mdFiles.filter(f => f.match) }
`, '0. workspace:list 递归找 \"链接跳转测试.md\"')

// 1. 如果找到第一个匹配，通过 larify:workbench-open 打开它所在 root
const opened = await run(`
  const list = await window.bridge.invoke('resource:list')
  const id = list.find(r => r.type === 'workspace')?.id ?? 1
  const { root } = await window.bridge.invoke('workspace:list', id)
  window.dispatchEvent(new CustomEvent('larify:workbench-open', {
    detail: { rendererId: 'workspace', options: { root } }
  })
  return { dispatched: true, root }
`, '1. 发 workbench-open 打开 workspace')
await wait(1000)

// 2. 等一下 + 点击 workbench tab 里的链接跳转测试 md 文件（如果此时还没打开具体文件）
// 直接点击 treeitem 中叫"链接跳转测试.md"的
const clicked = await run(`
  const item = Array.from(document.querySelectorAll('[role="treeitem"] .rc-tree-title')).find(t => /链接跳转测试/.test(t.textContent ?? ''))
  const treeitem = item?.closest('[role="treeitem"]')
  if (treeitem) { treeitem.click(); return { clicked: item.textContent } }
  // 没找到，已经点击第一个 .md 文件
  const anyMd = Array.from(document.querySelectorAll('[role="treeitem"] .rc-tree-title')).find(t => t.textContent?.toLowerCase().endsWith('.md'))
  if (anyMd) { anyMd.closest('[role="treeitem"]')?.click(); return { clickedAny: anyMd.textContent } }
  return { clicked: null }
`, '2. 点击 md 文件名（优先"链接跳转测试.md"，否则第一个 md')
await wait(900)

// 3. 检查 preview
const step3 = await run(`
  const preview = document.querySelector('.workspace-markdown-preview')
  if (!preview) return { noPreview: true }
  const links = Array.from(preview.querySelectorAll('button.larify-message-link, a.larify-message-link'))
  return {
    workspaceCount: document.querySelectorAll('[data-workbench-view="workspace"]').length,
    previewHead: preview.textContent?.slice(0, 80),
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 50), href: l.getAttribute('href') }))
  }
`, '3. 预览 + 链接元素检查')

// 4. 点击第一个链接
if (step3.links && step3.links.length > 0) {
  await run(`
    const l = document.querySelector('.workspace-markdown-preview button.larify-message-link, .workspace-markdown-preview a.larify-message-link')
    if (!l) return 'none'
    l.click()
    return { tag: l.tagName, text: l.textContent?.trim().slice(0, 50) }
  `, '4. 点击第一个链接')
  await wait(2500)
  await run(`
    const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
    const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim())
    const selected = Array.from(document.querySelectorAll('[role="treeitem"].rc-tree-node-selected .rc-tree-title')).map(t => t.textContent?.trim())
    return { workspaceCountAfter: count, tabTitles: tabs.slice(-10), selected }
  `, '5. 点击后结果')
}

console.log('\n=== Errors (last 5):')
for (const e of errors.slice(-5)) console.log(' ', e.slice(0, 600))
process.exit(0)
