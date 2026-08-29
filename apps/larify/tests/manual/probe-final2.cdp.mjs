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
  console.log('  =', JSON.stringify(r).slice(0, 800))
  return r
}

// Step 0: 激活 session（点一下 session item）
const pre = await run(`
  const sessionBtn = Array.from(document.querySelectorAll('button[data-session-id]')).pop()
  if (sessionBtn) { sessionBtn.click(); return { clicked: sessionBtn.dataset.sessionId, label: sessionBtn.textContent?.trim().slice(0,50) } }
  return { clicked: null }
`, '0. 激活最后一个 session')
await wait(1200)

// Step 1: 检查链接是否变 button
const info = await run(`
  const ws = document.querySelector('[data-workbench-session][data-active] [data-workbench-view="workspace"][data-active]')
  if (!ws) return { err: 'no active workspace', html: document.body.innerHTML?.slice(0, 600) }
  const preview = ws.querySelector('.workspace-markdown-preview')
  const links = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
  return {
    previewFound: !!preview,
    workspaceCount: document.querySelectorAll('[data-workbench-view="workspace"]').length,
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 50), href: l.getAttribute('href') })),
  }
`, '1. 链接元素检查')

// Step 2: 点击第一个 file 链接
const click = await run(`
  const ws = document.querySelector('[data-workbench-session][data-active] [data-workbench-view="workspace"][data-active]')
  const preview = ws?.querySelector('.workspace-markdown-preview')
  const l = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
    .find(el => /workspace-view\\.tsx|tsx/i.test(el.textContent ?? ''))
  if (!l) return '__no_link__'
  l.click()
  return { tag: l.tagName, text: l.textContent?.trim().slice(0,50) }
`, '2. 点击链接')

await wait(2000)

// Step 3: 结果
const post = await run(`
  const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
  const previews = Array.from(document.querySelectorAll('.workspace-markdown-preview, .monaco-editor'))
  const heads = previews.map(p => p.textContent?.slice(0, 100) ?? '')
  const selectedTitles = Array.from(document.querySelectorAll('[role="treeitem"].rc-tree-node-selected .rc-tree-title')).map(t => t.textContent?.trim())
  return { workspaceCountAfter: count, previewHeads: heads.slice(0, 4), selectedTreeTitles: selectedTitles }
`, '3. 点击后结果（workspace count / 文件预览文本 / 选中的树节点标题）')

console.log('\n=== Runtime errors (last 5):')
for (const e of errors.slice(-5)) console.log(' ', e.slice(0, 500))
process.exit(0)
