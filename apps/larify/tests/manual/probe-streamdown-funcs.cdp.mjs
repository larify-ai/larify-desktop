/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const app = await connectLarifyCdp(process.env.LARIFY_CDP_PORT ?? '9222')

const markdown = [
  '![local](./img/photo.png)',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  'inline math $x^2$',
  '',
  '$$\\frac{a}{b}$$',
  '',
  '```mermaid',
  'graph TD; A-->B',
  '```',
  '',
  '> quote',
  '',
  '- list',
  '',
  '[link](D:/doc.md)'
].join('\n')

const out = await app.evaluate(`(async () => {
  const [react, reactDomClient, streamdown, cjk, code, math, mermaid] = await Promise.all([
    import('/@id/react'), import('/@id/react-dom/client'), import('/@id/streamdown'),
    import('/@id/@streamdown/cjk'), import('/@id/@streamdown/code'), import('/@id/@streamdown/math'), import('/@id/@streamdown/mermaid')
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
  const plugins = { cjk: cjk.cjk, code: code.code, math: math.math, mermaid: mermaid.mermaid }
  const host = document.createElement('div'); host.style.display='none'; document.body.append(host)
  const root = createRoot(host)
  const errors = []
  const origError = console.error
  console.error = (...a) => { errors.push(a.map(String).join(' ')); origError(...a) }
  const Img = (props) => { const { node: _n, ...rest } = props; return createElement('img', rest) }
  await new Promise((resolve) => {
    try {
      root.render(createElement(Streamdown, {
        mode: 'static',
        components: { img: Img, a: (p) => { const { node: _n, ...rest } = p; return createElement('a', rest) } },
        rehypePlugins,
        plugins
      }, ${JSON.stringify(markdown)}))
      setTimeout(resolve, 2500)
    } catch (e) { errors.push('throw:' + e); resolve() }
  })
  const result = {
    tables: host.querySelectorAll('table').length,
    tableCols: host.querySelectorAll('table th').length,
    katex: host.querySelectorAll('.katex').length,
    mermaid: host.querySelectorAll('[data-streamdown="diagram"], .mermaid, svg').length,
    codeBlocks: Array.from(host.querySelectorAll('[data-streamdown="code-block"]')).map((el) => el.getAttribute('data-language')),
    blockquote: host.querySelectorAll('blockquote').length,
    lists: host.querySelectorAll('ul, ol').length,
    imgs: Array.from(host.querySelectorAll('img')).map((el) => el.getAttribute('src')),
    anchors: Array.from(host.querySelectorAll('a')).map((el) => el.getAttribute('href')),
    errors: errors.slice(0, 3)
  }
  root.unmount(); host.remove()
  return JSON.stringify(result, null, 2)
})()`)

console.log(out)
app.close()
