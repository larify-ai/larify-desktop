/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'
const app = await connectLarifyCdp()
console.log('[CDP] connected')
await app.send('Runtime.enable')

const r = await app.evaluate(`
Promise.resolve().then(() => {
  const root = document.getElementById('root')
  const containerKey = Object.keys(root ?? {}).find(k => k.startsWith('__reactContainer'))
  if (!containerKey || !root) return { err: 'no react root' }
  const container = root[containerKey]
  let current = container?.current ?? container?.child ?? null
  const findings = []
  const seen = new Set()
  let depth = 0
  while (current && depth < 20000 && !seen.has(current)) {
    seen.add(current)
    const type = current.type
    const name = typeof type === 'string' ? type : (type?.displayName ?? type?.name ?? '')
    const props = current.memoizedProps ?? {}
    const keys = Object.keys(props)
    if (/MarkdownPreview/.test(name)) {
      findings.push({
        _MARK: 'MarkdownPreview', name,
        props: keys,
        file: typeof props.file === 'object' ? { path: props.file.path, kind: props.file.kind, ext: props.file.ext } : null,
        stateKeys: current.memoizedState ? Object.keys(current.memoizedState).slice(0, 20) : null,
      })
      // 读 memoizedState.queue.baseState（useTextFile 的 content）——这里能拿到传给 XMarkdown 的 content 原始值
      try {
        let s = current.memoizedState
        let i = 0
        while (s && i < 50) {
          if (typeof s.memoizedState === 'string' && /链接跳转|workspace-view|# /.test(s.memoizedState)) {
            findings.push({ _MARK: 'FOUND_CONTENT_IN_HOOK', i, contentPreview: s.memoizedState.slice(0, 2500) })
          }
          s = s.next
          i++
        }
      } catch (e) { findings.push({ errWalk: String(e).slice(0,300) }) }
    }
    if (/XMarkdown/.test(name)) {
      findings.push({
        _MARK: 'XMarkdown', name,
        components_a_name: typeof props.components?.a === 'function'
          ? (props.components.a.displayName || props.components.a.name || '<anon-fn>')
          : String(props.components?.a),
        contentPreview: typeof props.content === 'string' ? props.content.slice(0, 2500) : null,
      })
    }
    if (name === 'MessageLink' || name === 'BoundMessageLink' || name === 'a' || name === 'button') {
      const href = props.href ?? props.node?.href ?? props.node?.properties?.href ?? null
      if (href != null || /larify-message-link/.test(props.className ?? '')) {
        findings.push({ name, href, className: (props.className ?? '').slice(0, 60), children: typeof props.children === 'string' ? props.children.slice(0, 50) : (Array.isArray(props.children) ? JSON.stringify(props.children.slice(0, 3)).slice(0, 80) : null) })
      }
    }
    if (current.child) { current = current.child; depth++; continue }
    while (current && !current.sibling && current.return) { current = current.return; depth-- }
    current = current ? current.sibling : null
  }
  return findings
})
`)
console.log(JSON.stringify(r, null, 2).slice(0, 25000))
process.exit(0)
