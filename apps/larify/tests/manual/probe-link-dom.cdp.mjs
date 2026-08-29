/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const app = await connectLarifyCdp(process.env.LARIFY_CDP_PORT ?? '9222')

const markdown = [
  '[drive-back](D:\\\\Workspace\\\\a.txt)',
  '[drive-forward](D:/Workspace/b.txt)',
  '[angle](<D:\\\\Workspace\\\\a b.txt>)',
  '[unc](\\\\\\\\server\\\\share\\\\file.txt)',
  '[relative](a\\\\b\\\\c.ts)',
  '[dotrel](.\\\\b\\\\c.ts)',
  '[url](https://example.com/path)',
  '[fileurl](file:///D:/Workspace/c.txt)'
].join('\\n\\n')

const dump = await app.evaluate(`(async () => {
  const [react, reactDom, reactDomClient, { MessageMarkdown }, messageLinks, workspaceLink] =
    await Promise.all([
      import('/@id/react'),
      import('/@id/react-dom'),
      import('/@id/react-dom/client'),
      import('/src/app/interaction/assistant/message-parts/message-markdown.tsx'),
      import('/src/app/interaction/assistant/message-links.ts'),
      import('/src/lib/workspace-link.ts')
    ])
  const { createMessageLinkHandler, MessageLinkContextProvider } = messageLinks
  const createElement = react.createElement ?? react.default?.createElement
  const flushSync = reactDom.flushSync ?? reactDom.default?.flushSync
  const createRoot = reactDomClient.createRoot ?? reactDomClient.default?.createRoot
  const host = document.createElement('div')
  host.id = 'probe-link-dom-root'
  host.style.display = 'none'
  document.body.append(host)
  const resources = await window.bridge.invoke('resource:list')
  const sessionId = resources.findLast(({ type }) => type === 'workspace')?.sessionId
  const handler = createMessageLinkHandler('', sessionId)
  const root = createRoot(host)
  flushSync(() => root.render(
    createElement(MessageLinkContextProvider, { value: handler },
      createElement(MessageMarkdown, { isAnimating: false }, ${JSON.stringify(markdown)})
    )
  ))
  window.__probeCleanup = () => { handler.dispose(); root.unmount(); host.remove(); delete window.__probeCleanup }
  const raw = ${JSON.stringify(markdown)}
  const elements = Array.from(host.querySelectorAll('.larify-message-link')).map((el) => ({
    tag: el.tagName, text: el.textContent, href: el.getAttribute('href')
  }))
  const all = Array.from(host.querySelectorAll('a,button')).map((el) => ({
    tag: el.tagName, text: el.textContent, href: el.getAttribute('href')
  }))
  const resolves = ['file:///D:/Workspace/a.txt','file:////server/share/file.txt','file://server/share/file.txt','D:/Workspace/a.txt']
    .map((href) => {
      try { return { href, resolved: workspaceLink.resolveWorkspaceLink('D:\\\\base', href).path }
      } catch (error) { return { href, error: String(error) } }
    })
  return { raw, elements, all, resolves, html: host.innerHTML.slice(0, 1200) }
})()`)

console.log('RAW:', dump.raw)
console.log('LINKS:', JSON.stringify(dump.elements, null, 2))
console.log('ALL:', JSON.stringify(dump.all, null, 2))
console.log('RESOLVES:', JSON.stringify(dump.resolves, null, 2))
console.log('HTML:', dump.html)

await app.evaluate(`window.__probeCleanup?.()`).catch(() => undefined)
app.close()
