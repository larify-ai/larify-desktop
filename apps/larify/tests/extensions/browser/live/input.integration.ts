import { app, BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import { BrowserTab } from '../../../../src/extensions/browser/main/tab'

function listen(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html>
        <input id="text" value="abc">
        <input id="fill" value="old">
        <textarea id="typed">old</textarea>
        <div id="editable" contenteditable="true">old</div>
        <textarea id="keys"></textarea>
        <div style="height:3000px"></div>
        <script>
          window.editEvents = []
          for (const id of ['fill', 'typed', 'editable']) {
            const element = document.querySelector('#' + id)
            for (const type of ['keydown', 'keyup', 'beforeinput', 'input']) {
              element.addEventListener(type, (event) => window.editEvents.push({
                id, type, key: event.key, inputType: event.inputType
              }))
            }
          }
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
    tab = new BrowserTab(1, `input-live-${Date.now()}`)
    tab.view.webContents.setBackgroundThrottling(false)
    window.contentView.addChildView(tab.view)
    tab.view.setBounds({ x: 0, y: 0, width: 600, height: 500 })
    await tab.navigateAndWait(`http://127.0.0.1:${address.port}`)

    await tab.fill('#fill', 'filled')
    await tab.type('#typed', 'A\nB', true)
    await tab.fill('#editable', 'edited')
    const editResult = (await tab.evalJs(`() => ({
      fill: document.querySelector('#fill').value,
      typed: document.querySelector('#typed').value,
      editable: document.querySelector('#editable').textContent,
      events: window.editEvents
    })`)) as {
      fill: string
      typed: string
      editable: string
      events: Array<{ id: string; type: string; key?: string; inputType?: string }>
    }
    if (
      editResult.fill !== 'filled' ||
      editResult.typed !== 'A\nB' ||
      editResult.editable !== 'edited'
    ) {
      throw new Error(`Native clear and edit failed: ${JSON.stringify(editResult)}`)
    }
    for (const id of ['fill', 'typed', 'editable']) {
      const events = editResult.events.filter((event) => event.id === id)
      if (!events.some((event) => event.type === 'keydown' && event.key === 'Backspace')) {
        throw new Error(`Missing native clear key for ${id}: ${JSON.stringify(events)}`)
      }
      if (!events.some((event) => event.type === 'input')) {
        throw new Error(`Missing native input event for ${id}: ${JSON.stringify(events)}`)
      }
    }

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

    const printableAscii = Array.from({ length: 95 }, (_, index) =>
      String.fromCharCode(32 + index)
    ).join('')
    await tab.evalJs(`() => {
      const input = document.querySelector('#keys')
      window.keyEvents = []
      input.addEventListener('keydown', (event) => window.keyEvents.push({
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey
      }))
      input.focus()
    }`)
    await tab.keyboardType(printableAscii)
    const keymapResult = (await tab.evalJs(`() => ({
      value: document.querySelector('#keys').value,
      events: window.keyEvents
    })`)) as {
      value: string
      events: Array<{ key: string; code: string; shiftKey: boolean }>
    }
    if (keymapResult.value !== printableAscii) {
      throw new Error(`Printable ASCII input mismatch: ${JSON.stringify(keymapResult.value)}`)
    }
    const shifted = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ~!@#$%^&*()_+{}|:"<>?')
    if (
      keymapResult.events.length !== printableAscii.length ||
      keymapResult.events.map(({ key }) => key).join('') !== printableAscii ||
      keymapResult.events.some(({ code }) => !code) ||
      keymapResult.events.some(({ key, shiftKey }) => shiftKey !== shifted.has(key))
    ) {
      throw new Error(`Printable ASCII key events mismatch: ${JSON.stringify(keymapResult.events)}`)
    }

    tab.view.webContents.focus()
    await tab.mouseMove(400, 400)
    await tab.mouseWheel(0, 500)
    const scrollY = await tab.evalJs('() => window.scrollY')
    if (scrollY !== 500) throw new Error(`Wheel resolved before scrolling: ${scrollY}`)

    await tab.evalJs(`() => {
      window.mouseButtons = []
      for (const type of ['mousedown', 'mousemove', 'wheel', 'mouseup']) {
        document.addEventListener(type, (event) =>
          window.mouseButtons.push({ type: event.type, button: event.button, buttons: event.buttons }), true)
      }
    }`)
    await tab.mouseDown('left')
    await tab.mouseDown('right')
    await tab.mouseMove(400, 400)
    await tab.mouseWheel(0, 1)
    await tab.mouseUp('left')
    await tab.mouseUp('right')
    const mouseButtons = (await tab.evalJs('() => window.mouseButtons')) as Array<{
      type: string
      button: number
      buttons: number
    }>
    const expectedMouseButtons = [
      ['mousedown', 0, 1],
      ['mousedown', 2, 3],
      ['mousemove', 0, 3],
      ['wheel', 0, 3],
      ['mouseup', 0, 2],
      ['mouseup', 2, 0]
    ]
    for (const [type, button, buttons] of expectedMouseButtons) {
      if (!mouseButtons.some((event) =>
        event.type === type && event.button === button && event.buttons === buttons)) {
        throw new Error(`Missing mouse state ${type}:${button}:${buttons}: ${JSON.stringify(mouseButtons)}`)
      }
    }

    const namedKeys = [
      'Alt',
      'Control',
      'Meta',
      'Shift',
      'Enter',
      'Tab',
      'Escape',
      'Backspace',
      'Delete',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Space'
    ]
    await tab.evalJs(`() => {
      window.namedKeyEvents = []
      document.addEventListener('keydown', (event) =>
        window.namedKeyEvents.push({ type: event.type, key: event.key }), true)
      document.addEventListener('keyup', (event) =>
        window.namedKeyEvents.push({ type: event.type, key: event.key }), true)
      document.querySelector('#keys').focus()
    }`)
    for (const key of namedKeys) {
      await tab.keyDown(key)
      await tab.keyUp(key)
      if (key === 'Tab') await tab.evalJs(`() => document.querySelector('#keys').focus()`)
    }
    const namedKeyEvents = (await tab.evalJs(`() => window.namedKeyEvents`)) as Array<{
      type: string
      key: string
    }>
    const expectedNamedKeys = namedKeys.map((key) => key === 'Space' ? ' ' : key)
    for (const key of expectedNamedKeys) {
      if (!namedKeyEvents.some((event) => event.type === 'keydown' && event.key === key)) {
        throw new Error(`Missing named keyDown: ${JSON.stringify(key)}`)
      }
      if (!namedKeyEvents.some((event) => event.type === 'keyup' && event.key === key)) {
        throw new Error(`Missing named keyUp: ${JSON.stringify(key)}`)
      }
    }

    console.log(`PASS concurrent keyboard chord ${JSON.stringify(value)}`)
    console.log(`PASS concurrent high-level press ${JSON.stringify(highLevelValue)}`)
    console.log(`PASS native fill/type/contenteditable`)
    console.log(`PASS printable ASCII keymap ${keymapResult.events.length} keys`)
    console.log(`PASS named keymap ${expectedNamedKeys.length} keys`)
    console.log(`PASS combined mouse buttons ${expectedMouseButtons.length} states`)
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
