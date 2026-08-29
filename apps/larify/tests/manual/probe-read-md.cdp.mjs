/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'
const app = await connectLarifyCdp()
console.log('[CDP] connected')
await app.send('Runtime.enable')

const r = await app.evaluate(`Promise.resolve().then(async () => {
  // 从 WorkspaceView.fiber 取 resourceId / root，或直接读 DOM 里第一个选中 treeitem 的路径
  // 先用 resource:list 拿所有 workspace 资源（这次读所有的 root，然后对每个 root walk 所有 dir 找 name 包含 链接跳转 的文件）
  const list = await window.bridge.invoke('resource:list')
  const wsIds = list.filter(r => r.type === 'workspace').map(r => r.id)
  const allRoots = new Set()
  for (const id of wsIds) {
    try {
      const res = await window.bridge.invoke('workspace:list', id)
      allRoots.add(JSON.stringify({ id, root: res.root }))
    } catch (_) {}
  }
  const rootsArr = Array.from(allRoots).map(s => JSON.parse(s))

  const hits = []
  for (const { id, root } of rootsArr) {
    const stack = [{ dir: root }]
    let seen = 0
    while (stack.length && seen < 3000) {
      const { dir } = stack.shift()
      seen++
      try {
        const res = await window.bridge.invoke('workspace:list', id, dir)
        if (!res?.entries) continue
        for (const e of res.entries) {
          const isDir = e.type === 'directory' || e.kind === 'directory' || (!e.name?.includes('.') && (e.children || !e.path?.includes('.')))
          const name = e.name ?? ''
          const p = e.path ?? (dir.endsWith('/') ? dir : dir + '/') + name
          if (name.toLowerCase().endsWith('.md')) {
            try {
              const content = await window.bridge.invoke('workspace:read', id, p)
              const text = typeof content === 'string' ? content : (content?.bytes ? new TextDecoder().decode(content.bytes) : '')
              if (/workspace-view/.test(text) || /链接跳转/.test(name)) hits.push({ id, root, name, path: p, text })
            } catch (_) {}
          }
          if (isDir) stack.push({ dir: p })
        }
      } catch (_) {}
    }
  }
  // 最后：读当前预览的实际 text 里是否有 href
  const preview = document.querySelector('.workspace-markdown-preview')
  const msg = preview ? Array.from(preview.querySelectorAll('.larify-message-link')).map((l, i) => {
    const fiberKey = Object.keys(l).find(k => k.startsWith('__react'))
    const f = fiberKey ? l[fiberKey] : null
    // 读 domNode 本身的 attribs 完整列表
    const d = f?.memoizedProps?.domNode
    const allAttrs = d?.attribs ? Object.keys(d.attribs).map(k => [k, d.attribs[k]]) : (d?.attributes ? d.attributes.map(a => [a.name, a.value]) : [])
    const parentF = f?.return?.return?.return?.memoizedProps?.domNode
    const parentAttrs = parentF?.attribs ? Object.keys(parentF.attribs).map(k => [k, parentF.attribs[k]]) : (parentF?.attributes ? parentF.attributes.map(a => [a.name, a.value]) : [])
    return { i, attrs: allAttrs, parentAttrs, outerHTML: l.outerHTML }
  }) : []
  return { rootsArr, hits: hits.map(h => ({ name: h.name, path: h.path, text: h.text.slice(0, 5000) })), linkDomNodes: msg }
})`)
console.log(JSON.stringify(r, null, 2).slice(0, 32000))
process.exit(0)
