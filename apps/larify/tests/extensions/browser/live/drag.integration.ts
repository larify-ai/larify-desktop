import { app, BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import { BrowserTab } from '../../../../src/extensions/browser/main/tab'

function listen(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html>
        <style>#source,#target,#pointer-source,#pointer-target{width:120px;height:60px;margin:30px;padding:10px}</style>
        <div id="source" draggable="true">source</div>
        <div id="target">target</div>
        <div id="pointer-source">pointer source</div>
        <div id="pointer-target">pointer target</div>
        <script>
          window.events = { dragstart: 0, dragover: 0, drop: 0 }
          source.addEventListener('dragstart', (event) => {
            events.dragstart++
            event.dataTransfer.setData('text/plain', 'source')
          })
          target.addEventListener('dragover', (event) => {
            events.dragover++
            event.preventDefault()
          })
          target.addEventListener('drop', (event) => {
            events.drop++
            event.preventDefault()
            target.textContent = 'dropped'
          })
          let pointerDragging = false
          document.querySelector('#pointer-source').addEventListener('pointerdown', () => {
            pointerDragging = true
          })
          document.querySelector('#pointer-target').addEventListener('pointerup', (event) => {
            if (!pointerDragging) return
            pointerDragging = false
            event.currentTarget.textContent = 'pointer dropped'
          })
        </script>`)
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
    tab = new BrowserTab(1, `drag-live-${Date.now()}`)
    window.contentView.addChildView(tab.view)
    tab.view.setBounds({ x: 0, y: 0, width: 600, height: 500 })
    await tab.navigateAndWait(`http://127.0.0.1:${address.port}`)

    await tab.drag('#source', '#target')
    const result = (await tab.evalJs(
      `() => ({ text: document.querySelector('#target').textContent, events: window.events })`,
    )) as { text: string; events: Record<string, number> }

    if (
      result.text !== 'dropped' ||
      result.events.dragstart < 1 ||
      result.events.dragover < 1 ||
      result.events.drop !== 1
    ) {
      throw new Error(`HTML5 drag did not complete: ${JSON.stringify(result)}`)
    }
    await tab.drag('#pointer-source', '#pointer-target')
    const pointerText = await tab.evalJs(
      `() => document.querySelector('#pointer-target').textContent`,
    )
    if (pointerText !== 'pointer dropped') {
      throw new Error(`Pointer drag did not complete: ${JSON.stringify(pointerText)}`)
    }
    console.log(`PASS HTML5 drag and drop ${JSON.stringify(result)}`)
    console.log(`PASS pointer drag and drop ${JSON.stringify(pointerText)}`)
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
