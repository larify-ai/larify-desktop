/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'
const app = await connectLarifyCdp()
console.log('[CDP] connected')
await app.send('Runtime.enable')

const label = '当前预览情况（检查 links[0].fiber.domNode.attribs.href 是否存在）'
const r = await app.evaluate(`Promise.resolve().then(() => {
  const preview = document.querySelector('.workspace-markdown-preview')
  if (!preview) return { noPreview: true }
  const links = Array.from(preview.querySelectorAll('button.larify-message-link, a.larify-message-link'))
  const out = {
    previewFound: true,
    head: preview.textContent?.slice(0, 80),
    links: links.map((l, i) => ({ i, tag: l.tagName, text: l.textContent?.trim().slice(0, 50), href: l.getAttribute('href') })),
  }
  const firstLink = links[0]
  if (firstLink) {
    const fiberKey = Object.keys(firstLink).find(k => k.startsWith('__react'))
    if (fiberKey) {
      const f = firstLink[fiberKey]
      const props = f?.memoizedProps
      const d = props?.domNode
      const d_attribsHref = typeof d?.attribs === 'object' ? (d.attribs.href ?? null) : null
      const d_getAttrHref = typeof d?.getAttribute === 'function' ? d.getAttribute('href') : null
      const d_attrArrHref = Array.isArray(d?.attributes) ? (d.attributes.find(a => a.name === 'href')?.value ?? null) : null
      out.firstFiber = {
        domNodeExists: !!d,
        domNodeType: d ? (d.nodeType ?? d.type ?? typeof d) : null,
        'domNode.attribs.href': d_attribsHref,
        'domNode.getAttribute("href")': d_getAttrHref,
        'domNode.attributes[href]': d_attrArrHref,
        propsHref: props?.href ?? null,
        propsNodeHref: props?.node?.href ?? null,
        propsNodePropHref: props?.node?.properties?.href ?? null,
      }
    }
  }
  return out
})`)
console.log('\n→ ' + label)
console.log(JSON.stringify(r, null, 2).slice(0, 3500))
process.exit(0)
