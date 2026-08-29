/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const port = process.env.LARIFY_CDP_PORT ?? '9222'

const app = await connectLarifyCdp(port)

async function waitFor(expression, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await app.evaluate(expression)) return
    await wait(100)
  }
  assert.fail(`${message}`)
}

try {
  await app.send('Page.reload', { ignoreCache: true })
  console.log('[reload] done')
  await waitFor(
    `Boolean(document.querySelector('button[aria-label="显示工作台"]'))`,
    'renderer readiness'
  )
  console.log('[ready] workbench button exists')
  await app.evaluate(`document.querySelector('button[aria-label="显示工作台"]')?.click()`)
  await wait(300)
  console.log('[clicked] workbench')
  await app.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === '文件'
    )
    button?.click()
  })()`)
  await wait(600)
  console.log('[clicked] files')

  const mounted = await app.evaluate(`(async () => {
    const [react, reactDom, reactDomClient, { MessageMarkdown }, messageLinks] =
      await Promise.all([
        import('/@id/react'),
        import('/@id/react-dom'),
        import('/@id/react-dom/client'),
        import('/src/app/interaction/assistant/message-parts/message-markdown.tsx'),
        import('/src/app/interaction/assistant/message-links.ts')
      ])
    const { createMessageLinkHandler, MessageLinkContextProvider } = messageLinks
    const createElement = react.createElement ?? react.default?.createElement
    const flushSync = reactDom.flushSync ?? reactDom.default?.flushSync
    const createRoot = reactDomClient.createRoot ?? reactDomClient.default?.createRoot
    const host = document.createElement('div')
    host.id = 'model-markdown-links-cdp-root'
    host.style.display = 'none'
    document.body.append(host)
    const resources = await window.bridge.invoke('resource:list')
    const sessionId = resources.findLast(({ type }) => type === 'workspace')?.sessionId
    if (!sessionId) throw new Error('active session is unavailable')
    const handler = createMessageLinkHandler('', sessionId)
    const root = createRoot(host)
    const markdown = [
      '[drive-back](D:\\\\Workspace\\\\a.txt)',
      '[drive-forward](D:/Workspace/b.txt)',
      '[angle](<D:\\\\Workspace\\\\a b.txt>)',
      '[unc](\\\\\\\\server\\\\share\\\\file.txt)',
      '[relative](a\\\\b\\\\c.ts)',
      '[url](https://example.com/path)',
      '[reused-file](file:///D:/Workspace/c.txt)'
    ].join('\\n\\n')
    flushSync(() => root.render(
      createElement(MessageLinkContextProvider, { value: handler },
        createElement(MessageMarkdown, { isAnimating: false }, markdown)
      )
    ))
    window.__modelMarkdownLinksCdpCleanup = () => {
      handler.dispose()
      root.unmount()
      host.remove()
      delete window.__modelMarkdownLinksCdpCleanup
    }
    return host.querySelectorAll('a').length
  })()`)
  console.log('[mounted]', mounted)
  assert.ok(typeof mounted === 'number' && mounted > 0, 'expected rendered links')

  const links = await app.evaluate(`(() =>
    Array.from(document.querySelectorAll('#model-markdown-links-cdp-root a')).map((a) => ({
      text: a.textContent,
      href: a.getAttribute('href')
    }))
  )()`)
  console.log('[links]', JSON.stringify(links, null, 2))
  assert.ok(Array.isArray(links) && links.length > 0, 'expected links array')

  const byText = (text) => links.find((link) => link.text === text)
  assert.equal(
    byText('drive-back')?.href,
    'file:///D:/Workspace/a.txt',
    'drive-back should be normalised to a file URL'
  )
  assert.equal(
    byText('drive-forward')?.href,
    'file:///D:/Workspace/b.txt',
    'drive-forward should be normalised to a file URL'
  )
  assert.equal(
    byText('angle')?.href,
    'file:///D:/Workspace/a%20b.txt',
    'angle-bracket destination with a space should be normalised and encoded'
  )
  assert.equal(
    byText('unc')?.href,
    'file:////server/share/file.txt',
    'UNC path should become a file URL (not a protocol-relative URL)'
  )
  assert.equal(
    byText('relative')?.href,
    'a/b/c.ts',
    'relative Windows path should have separators normalised'
  )
  assert.equal(
    byText('url')?.href,
    'https://example.com/path',
    'a URL must remain untouched'
  )
  assert.equal(
    byText('reused-file')?.href,
    'file:///D:/Workspace/c.txt',
    'an already-prefixed file URL must remain untouched'
  )

  console.log('model-markdown-links CDP regression passed')
} catch (error) {
  console.error('CDP test FAILED:', error.message)
  throw error
} finally {
  await app.evaluate(`window.__modelMarkdownLinksCdpCleanup?.()`).catch(() => undefined)
  app.close()
}
