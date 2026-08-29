/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'
const app = await connectLarifyCdp()
console.log('[CDP] connected')
await app.send('Runtime.enable')

const r = await app.evaluate(`
Promise.resolve().then(() => {
  // 当前 DOM 中的链接 fiber 信息：用 DOM Fiber 的 pendingProps 读 node.properties
  const linkEl = document.querySelector('.workspace-markdown-preview .larify-message-link')
  const fiberKey = linkEl ? Object.keys(linkEl).find(k => k.startsWith('__react')) : null
  const fiber = linkEl && fiberKey ? linkEl[fiberKey] : null
  const parentFiber = fiber?.return
  const parentProps = parentFiber?.memoizedProps
  const parentNode = parentProps?.node

  // 还可以：直接解析 content 为 DOM（从 fiber 拿 content 字符串）
  // 另外：marked 在渲染端 eval 吗？XMarkdown 用的 marked 包通常叫 marked，我们直接找全局 marked 或 require
  const mod = window.__VITE_SSR_MANIFEST__ ? 'vite' : 'other'
  const xMarkdownEl = document.querySelector('.x-markdown-light, .x-markdown-dark, [class*="xmarkdown"]')
  const allFns = []
  // 遍历链接祖先 fiber 找组件类型名是 BoundMessageLink 的
  let f = fiber
  const ancestors = []
  for (let i = 0; i < 30 && f; i++) {
    const type = f.type
    const name = typeof type === 'string' ? type : (type?.displayName ?? type?.name ?? '')
    const keys = Object.keys(f.memoizedProps ?? {}).slice(0, 12)
    ancestors.push({ name, keys, href: f.memoizedProps?.href ?? null, nodeHref: f.memoizedProps?.node?.href ?? null, nodePropHref: f.memoizedProps?.node?.properties?.href ?? null, domNode_href: f.memoizedProps?.domNode?.getAttribute?.('href') ?? null })
    f = f.return
  }
  return {
    fiber_found: !!fiber,
    fiberMemoKeys: Object.keys(fiber?.memoizedProps ?? {}),
    parentType: typeof parentFiber?.type === 'string' ? parentFiber.type : (parentFiber?.type?.displayName ?? parentFiber?.type?.name ?? null),
    parentPropsKeys: Object.keys(parentProps ?? {}).slice(0, 20),
    parentNode: typeof parentNode === 'object' ? {
      href: parentNode?.href,
      properties_href: parentNode?.properties?.href,
      keys: Object.keys(parentNode ?? {}),
    } : null,
    ancestors,
    linkHTML: linkEl ?.outerHTML,
  }
})
`)
console.log(JSON.stringify(r, null, 2).slice(0, 18000))
process.exit(0)
