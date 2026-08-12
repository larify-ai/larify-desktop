import { app, BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import { BrowserTab } from '../../../../src/extensions/browser/main/tab'

function listen(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html>
        <input id="text" value="abc">
        <div style="height:3000px"></div>`)
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function main(): Promise<void> {
  const server = await listen()
  let window: BrowserWindow | undefined
  let tab: BrowserTab | undefined
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not bind')
    await app.whenReady()
    window = new BrowserWindow({ show: true, x: -2000, y: -2000, width: 600, height: 500 })
    tab = new BrowserTab(1, `input-live-${Date.now()}`)
    window.contentView.addChildView(tab.view)
    tab.view.setBounds({ x: 0, y: 0, width: 600, height: 500 })
    await tab.navigateAndWait(`http://127.0.0.1:${address.port}`)

    await tab.click('#text')
    await Promise.all([tab.keyDown('Control'), tab.keyDown('a')])
    await Promise.all([tab.keyUp('a'), tab.keyUp('Control')])
    await tab.keyboardInsertText('replaced')
    const value = await tab.evalJs(`() => document.querySelector('#text').value`)
    if (value !== 'replaced') throw new Error(`Concurrent chord failed: ${JSON.stringify(value)}`)

    await tab.evalJs(`() => { const input = document.querySelector('#text'); input.value = 'abc'; input.focus() }`)
    await Promise.all([tab.keyDown('Control'), tab.press('a')])
    await tab.keyUp('Control')
    await tab.keyboardInsertText('high-level')
    const highLevelValue = await tab.evalJs(`() => document.querySelector('#text').value`)
    if (highLevelValue !== 'high-level') {
      throw new Error(`Concurrent high-level press failed: ${JSON.stringify(highLevelValue)}`)
    }

    await tab.mouseWheel(0, 500)
    const scrollY = await tab.evalJs('() => window.scrollY')
    if (scrollY !== 500) throw new Error(`Wheel resolved before scrolling: ${scrollY}`)

    console.log(`PASS concurrent keyboard chord ${JSON.stringify(value)}`)
    console.log(`PASS concurrent high-level press ${JSON.stringify(highLevelValue)}`)
    console.log(`PASS completed mouse wheel ${scrollY}`)
  } finally {
    tab?.destroy()
    window?.destroy()
    server.close()
    app.quit()
  }
}

void main().catch((error) => {
  console.error(error)
  app.exit(1)
})
