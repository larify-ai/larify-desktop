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
  const r = await app.evaluate(`Promise.resolve().then(async () => { ${expr} })`)
  console.log('  =', JSON.stringify(r).slice(0, 1500))
  return r
}

// Step 0: 列出所有 workspace 根下 md 文件，找"链接跳转测试"
await run(`
  const list = await window.bridge.invoke('resource:list')
  const id = list.find(r => r.type === 'workspace')?.id ?? 1
  const res = await window.bridge.invoke('workspace:list', id)
  const { entries, root } = res
  window.__CDP_ROOT = root
  window.__CDP_WS_ID = id

  // 立即发 workbench-open
  window.dispatchEvent(new CustomEvent('larify:workbench-open', {
    detail: { rendererId: 'workspace', options: { root } }
  }))

  // 先读 workspace 下所有 md 文件名（不递归，只看 entries+下一层）
  const mds = entries.filter(e => e.name?.toLowerCase().endsWith('.md')).map(e => ({ name: e.name, path: e.path }))
  window.__CDP_MDS = mds
  return { root, mdNames: mds.map(m => m.name) }
`, '0. 新开 workspace tab + 列出所有 md 文件名')

await wait(1200)

// Step 1: 激活这个 tab（点击"工作空间 tab"对应的 session or latest workbench session）
// 然后点第一个 md 文件"链接跳转测试.md"（或第一个 md）
const step1 = await run(`
  // 点 session 最后一个（新开的 workspace tab 一定是最后一个）
  const btns = Array.from(document.querySelectorAll('button[data-session-id]'))
  const last = btns[btns.length - 1]
  if (last) last.click()
  await new Promise(r => setTimeout(r, 500))
  // 点 tree 中任意 .md 文件名
  const titles = Array.from(document.querySelectorAll('[role="treeitem"] .rc-tree-title'))
  const pick = titles.find(t => /链接跳转测试/.test(t.textContent ?? '')) || titles.find(t => t.textContent?.toLowerCase().endsWith('.md'))
  if (pick) pick.closest('[role="treeitem"]').click()
  await new Promise(r => setTimeout(r, 800))
  const preview = document.querySelector('.workspace-markdown-preview')
  const links = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
  return {
    lastSession: last?.textContent?.trim().slice(0,50),
    pickedMd: pick?.textContent,
    previewFound: !!preview,
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 50), href: l.getAttribute('href') })),
  }
`, '1. 激活新 session + 点"链接跳转测试.md"或第一个 md')

// Step 2: 点击第一个链接
if (step1.links && step1.links.length > 0) {
  await wait(200)
  await run(`
    const l = document.querySelector('.workspace-markdown-preview button.larify-message-link, .workspace-markdown-preview a.larify-message-link')
    if (l) { l.click(); return { tag: l.tagName, text: l.textContent?.trim().slice(0, 50) } }
    return null
  `, '2. 点击第一个链接')
  await wait(2500)
  await run(`
    const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
    const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim())
    const selected = Array.from(document.querySelectorAll('[role="treeitem"].rc-tree-node-selected .rc-tree-title')).map(t => t.textContent?.trim())
    return { workspaceCountAfter: count, tabTitles: tabs.slice(-12), selectedTreeTitles: selected }
  `, '3. 点击后结果（workspace 数/Tab 标题/选中的树节点）')
}

console.log('\n=== Runtime errors (last 5):')
for (const e of errors.slice(-5)) console.log(' ', e.slice(0, 600))
process.exit(0)
