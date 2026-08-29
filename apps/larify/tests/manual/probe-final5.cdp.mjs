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

// Step 0: 挨个点所有 session 按钮，只选第一个包含 .workspace-markdown-preview 的
const result = await run(`
  const btns = Array.from(document.querySelectorAll('button[data-session-id]'))
  let hitIdx = -1
  // 为了避免 for-await，一个个点，每点一次立即检查 DOM（DOM 同步变化，不需要等异步）
  for (let i = 0; i < btns.length; i++) {
    btns[i].click()
    // 点击 session list item 后 workbench 是同步切换的（渲染器内部状态切换），所以立即查询 DOM 就是最新的
    if (document.querySelector('.workspace-markdown-preview')) { hitIdx = i; break }
  }
  return { btns: btns.length, hitIdx, hitLabel: hitIdx >= 0 ? btns[hitIdx].textContent?.trim().slice(0,60) : null }
`, '0. 遍历 session，找到第一个含 workspace preview 的')

await wait(400)

// Step 1. 链接检查
const info = await run(`
  const preview = document.querySelector('.workspace-markdown-preview')
  const links = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
  return {
    previewFound: !!preview,
    workspaceCount: document.querySelectorAll('[data-workbench-view="workspace"]').length,
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 50), href: l.getAttribute('href') })),
  }
`, '1. 链接检查')

// Step 2. 点击第一个 tsx/或任意一个链接
const click = await run(`
  const preview = document.querySelector('.workspace-markdown-preview')
  const links = Array.from(preview?.querySelectorAll('button.larify-message-link, a.larify-message-link') ?? [])
  const l = links.find(el => /workspace-view\\.tsx|tsx/i.test(el.textContent ?? '')) || links[0]
  if (!l) return '__no_link__'
  l.click()
  return { idx: links.indexOf(l), tag: l.tagName, text: l.textContent?.trim().slice(0, 50) }
`, '2. 点击链接')

await wait(2500)

// Step 3. 结果
const post = await run(`
  const count = document.querySelectorAll('[data-workbench-view="workspace"]').length
  const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim())
  // 新打开的 workspace 里，目录树选中项或预览内容
  const selectedTree = Array.from(document.querySelectorAll('[role="treeitem"].rc-tree-node-selected .rc-tree-title')).map(t => t.textContent?.trim())
  return { workspaceCountAfter: count, tabTitles: tabs.slice(-10), selectedTreeTitles: selectedTree }
`, '3. 结果（workspace 数 / tab 标题 / 选中 tree node）')

console.log('\n=== Runtime errors (last 5):')
for (const e of errors.slice(-5)) console.log(' ', e.slice(0, 500))
process.exit(0)
