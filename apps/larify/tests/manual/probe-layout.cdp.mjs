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

// Step 0: 读左侧 workspace 相关的按钮（不是 session list，是 workspace 侧栏/导航）
const layout = await run(`
  // 左侧：workspace 导航条目（"工作空间"标题下的每一个可点击条目）
  const leftCandidates = Array.from(document.querySelectorAll('button, [role="treeitem"], a, [data-active]'))
    .filter(el => el.getClientRects().length > 0 && el.textContent?.trim().length > 0)
    .slice(0, 40)
    .map((el, i) => ({ i, tag: el.tagName, text: el.textContent?.trim().slice(0, 35), id: el.id || '', cls: (el.className || '').toString().slice(0, 60), role: el.getAttribute('role'), active: el.getAttribute('data-active') || el.classList.contains('bg-muted') }))
  // 检查是否有 .workspace-markdown-preview 已经在某个 workbench 里存在（可能 DOM 结构是另外的 data-attr）
  const allWorkspaces = document.querySelectorAll('[data-workbench-view="workspace"], [data-view="workspace"], [class*="workspace-view" i]')
  const previews = document.querySelectorAll('.workspace-markdown-preview, .x-markdown-light, .x-markdown-dark')
  const hasWorkbench = !!document.querySelector('[data-workbench-session]')
  return {
    leftNavItems: leftCandidates,
    allWorkspacesCount: allWorkspaces.length,
    previewCount: previews.length,
    hasWorkbench,
  }
`, '0. DOM 结构探索')

process.exit(0)
