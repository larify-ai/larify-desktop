/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const app = await connectLarifyCdp(process.env.LARIFY_CDP_PORT ?? '9222')

const markdown = [
  '[barefwd](D:/a/b.txt)',
  '[bareback](D:\\\\a\\\\b.txt)',
  '[fileurl](file:///D:/a/b.txt)',
  '[unc](\\\\\\\\srv\\\\share\\\\f.txt)',
  '[rel](a\\\\b\\\\c.ts)',
  '[relfwd](./a/b.md)',
  '[url](https://example.com/p)',
  '[anchor](#head)'
].join('\n')

const out = await app.evaluate(`(async () => {
  const [react, reactDomClient, xmarkdown] = await Promise.all([
    import('/@id/react'),
    import('/@id/react-dom/client'),
    import('/@id/@ant-design/x-markdown')
  ])
  const createElement = react.createElement ?? react.default?.createElement
  const createRoot = reactDomClient.createRoot ?? reactDomClient.default?.createRoot
  const XMarkdown = xmarkdown.XMarkdown ?? xmarkdown.default?.XMarkdown ?? xmarkdown.default
  const seen = []
  const host = document.createElement('div')
  host.style.display = 'none'
  document.body.append(host)
  const root = createRoot(host)
  const A = (props) => {
    seen.push({ text: String(props.children), propsHref: props.href })
    return createElement('a', props)
  }
  const allowed = /^(?:(?:https?|file|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$)|[a-z]:[\\\\/])/i
  await new Promise((resolve) => {
    root.render(createElement(XMarkdown, { components: { a: A }, dompurifyConfig: { ALLOWED_URI_REGEXP: allowed } }, ${JSON.stringify(markdown)}))
    setTimeout(resolve, 800)
  })
  const dom = Array.from(host.querySelectorAll('a')).map((el) => ({
    text: el.textContent,
    domHref: el.getAttribute('href')
  }))
  root.unmount(); host.remove()
  return JSON.stringify({ seen, dom }, null, 2)
})()`)

console.log(out)
app.close()
