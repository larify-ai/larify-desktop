/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const app = await connectLarifyCdp(process.env.LARIFY_CDP_PORT ?? '9222')

const markdown = [
  '[bare-back](D:\\\\a\\\\b.txt)',
  '[fileurl](file:///D:/a/b.txt)',
  '[uncfile](file://srv/share/f.txt)',
  '[unc](\\\\\\\\srv\\\\share\\\\f.txt)',
  '[rel](a/b/c.ts)',
  '[url](https://example.com/p)',
  '[anchor](#head)',
  '[js](javascript:alert(1))'
].join('\\n')

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
    seen.push({ text: String(props.children), href: props.href ?? null })
    return createElement('a', props)
  }
  const dompurifyConfig = {
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|file|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))/i
  }
  await new Promise((resolve) => {
    root.render(createElement(XMarkdown, { components: { a: A }, dompurifyConfig }, ${JSON.stringify(markdown)}))
    setTimeout(resolve, 800)
  })
  root.unmount(); host.remove()
  return JSON.stringify(seen, null, 2)
})()`)

console.log(out)
app.close()
