/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const app = await connectLarifyCdp(process.env.LARIFY_CDP_PORT ?? '9222')

const markdown = [
  '[barefwd](D:/a/b.txt)',
  '[fileurl](file:///D:/a/b.txt)',
  '[unc](\\srv\\share\\f.txt)',
  '[rel](a/b/c.ts)',
  '[relfwd](./a/b.md)',
  '[url](https://example.com/p)',
  '[anchor](#head)',
  '```ts\nconst x = 1\n```',
  '```mermaid\ngraph TD; A-->B\n```'
].join('\n')

const out = await app.evaluate(`(async () => {
  const [react, reactDomClient, streamdown] = await Promise.all([
    import('/@id/react'), import('/@id/react-dom/client'), import('/@id/streamdown')
  ])
  const createElement = react.createElement ?? react.default?.createElement
  const createRoot = reactDomClient.createRoot ?? reactDomClient.default?.createRoot
  const Streamdown = streamdown.Streamdown
  const defaultRehypePlugins = streamdown.defaultRehypePlugins
  const sanitize = defaultRehypePlugins.sanitize
  const schema = Array.isArray(sanitize) ? sanitize[1] : {}
  const protocols = Object.assign({}, schema.protocols)
  delete protocols.href
  protocols.src = [...(protocols.src ?? []), 'data']
  const rehypePlugins = Array.isArray(sanitize)
    ? [defaultRehypePlugins.raw, [sanitize[0], Object.assign({}, schema, { protocols })]]
    : [defaultRehypePlugins.raw, sanitize]
  const seen = []
  const host = document.createElement('div'); host.style.display='none'; document.body.append(host)
  const root = createRoot(host)
  const A = (props) => {
    const node = props.node
    seen.push({
      text: String(props.children),
      href: props.href,
      nodeHref: node?.properties?.href,
      hasNode: Boolean(node),
      hasDomNode: 'domNode' in props,
      keys: Object.keys(props).sort()
    })
    // pass through as anchor; drop node/domNode to avoid DOM warnings
    const { node: _n, ...rest } = props
    return createElement('a', rest)
  }
  await new Promise((resolve) => {
    root.render(createElement(Streamdown, {
      mode: 'static',
      components: { a: A },
      rehypePlugins
    }, ${JSON.stringify(markdown)}))
    setTimeout(resolve, 2000)
  })
  const dom = Array.from(host.querySelectorAll('a')).map((el) => ({
    text: el.textContent, domHref: el.getAttribute('href')
  }))
  const buttons = Array.from(host.querySelectorAll('button[data-streamdown="link"]')).map((el) => el.textContent)
  const codes = Array.from(host.querySelectorAll('[data-streamdown="code-block"]')).map((el) => el.getAttribute('data-language'))
  const mermaid = host.querySelectorAll('[data-streamdown="diagram"], .mermaid, svg').length
  root.unmount(); host.remove()
  return JSON.stringify({ seen, dom, buttons, codes, mermaid }, null, 2)
})()`)

console.log(out)
app.close()
