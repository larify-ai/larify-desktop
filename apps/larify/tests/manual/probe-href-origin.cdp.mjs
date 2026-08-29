/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'
const app = await connectLarifyCdp()
console.log('[CDP] connected')
await app.send('Runtime.enable')

const r = await app.evaluate(`Promise.resolve().then(() => {
  const preview = document.querySelector('.workspace-markdown-preview')
  if (!preview) return { noPreview: true }

  // 1. 找 larify-message-link 元素
  const linkEls = Array.from(preview.querySelectorAll('.larify-message-link'))
  const first = linkEls[0]
  if (!first) return { linksCount: 0 }

  // 2. 这个元素的完整 outerHTML
  const outerHTML = first.outerHTML
  // 3. 取 fiber
  const fKey = Object.keys(first).find(k => k.startsWith('__react'))
  let fiber = fKey ? first[fKey] : null
  const ancestors = []
  let hrefFound = []
  for (let i = 0; i < 40 && fiber; i++) {
    const type = fiber.type
    const name = typeof type === 'string' ? type : (type?.displayName ?? type?.name ?? (String(type).slice(0, 50)))
    const props = fiber.memoizedProps ?? {}
    const keys = Object.keys(props).slice(0, 10).join(',')
    const d = props.domNode
    const dHref = (typeof d?.getAttribute === 'function') ? d.getAttribute('href') : (d?.attribs?.href ?? null)
    if (props.href || dHref) hrefFound.push({ level: i, name, propsHref: props.href ?? null, dHref })
    ancestors.push({ i, name, keys })
    fiber = fiber.return
  }
  return {
    outerHTML,
    outerHTMLBefore: first.parentElement?.outerHTML?.slice?.(0, 500),
    ancestors,
    hrefFound,
    // 读预览文本里 <a> 的原始字符串（如果有）——不，直接看整个 preview 的 innerHTML：
    previewHTML: preview.innerHTML?.slice?.(0, 3000),
  }
})`)
console.log(JSON.stringify(r, null, 2).slice(0, 20000))
process.exit(0)
