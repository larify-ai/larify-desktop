/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import WebSocket from 'ws'

const port = process.env.LARIFY_CDP_PORT ?? '9222'
const targetUrl = `http://127.0.0.1:${port}/json/list`
const targets = await fetch(targetUrl).then((response) => response.json())
const target = targets.find(
  ({ type, url }) => type === 'page' && url.startsWith('http://localhost:')
)
if (!target?.webSocketDebuggerUrl) throw new Error(`Larify page not found at ${targetUrl}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})

let commandId = 0
const pending = new Map()
socket.on('message', (raw) => {
  const message = JSON.parse(String(raw))
  const command = pending.get(message.id)
  if (!command) return
  pending.delete(message.id)
  if (message.error) command.reject(new Error(message.error.message))
  else command.resolve(message.result)
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++commandId
    pending.set(id, { reject, resolve })
    socket.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description)
  return response.result.value
}

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

async function waitFor(expression, message, timeout = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${message}`)
}

async function clickSelector(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert.ok(point, `click target should exist: ${selector}`)
  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    clickCount: 1,
    type: 'mousePressed',
    ...point
  })
  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    clickCount: 1,
    type: 'mouseReleased',
    ...point
  })
}

async function openLauncher() {
  await evaluate(`document.querySelector('.larify-workbench-home')?.click()`)
  await evaluate(`document.querySelector('[aria-label="显示工作台"]')?.click()`)
  await waitFor(
    `(() => {
      const empty = document.querySelector('[data-testid="workbench-empty"]')
      const rect = empty?.getBoundingClientRect()
      return Boolean(empty && rect && rect.width > 0 && rect.height > 0)
    })()`,
    'workbench launcher'
  )
}

async function createTerminal() {
  await openLauncher()
  const tabCount = await evaluate(`document.querySelectorAll('.larify-workbench-tab').length`)
  const resourcesBefore = await evaluate(`window.bridge.invoke('resource:list')`)
  const opened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-testid="workbench-empty"] button')]
      .find((candidate) => candidate.textContent.trim() === '终端')
    button?.click()
    return Boolean(button)
  })()`)
  assert.equal(opened, true, 'terminal launcher button should exist')
  await waitFor(
    `document.querySelectorAll('.larify-workbench-tab').length === ${tabCount + 1}`,
    'terminal tab creation'
  )
  const resources = await waitFor(
    `(async () => {
      const resources = await window.bridge.invoke('resource:list')
      return resources.length === ${resourcesBefore.length + 1} ? resources : null
    })()`,
    'terminal resource creation'
  )
  const resource = resources.find(
    ({ id }) => !resourcesBefore.some((candidate) => candidate.id === id)
  )
  assert.ok(resource, 'created terminal resource should exist')
  await waitFor(
    `(async () => {
      const state = await window.bridge.invoke('terminal:getState', ${JSON.stringify(resource.sessionId)})
      return state.terminals.some(({ id }) => id === ${resource.id})
    })()`,
    'terminal shell readiness'
  )
  await waitFor(
    `(() => {
      const rect = document.querySelector('.xterm-screen')?.getBoundingClientRect()
      return Boolean(
        rect && rect.width > 0 && rect.height > 0 &&
        rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0
      )
    })()`,
    'visible terminal input'
  )
  await waitFor(
    `Boolean(document.querySelector('.xterm-rows')?.textContent.trim())`,
    'terminal prompt rendering'
  )
  const tab = await evaluate(`(() => {
    const tab = document.querySelector('.larify-workbench-tab:has([data-state="active"])')
    return { id: tab?.dataset.tabId, title: tab?.querySelector('.larify-workbench-tab-title')?.textContent }
  })()`)
  activeTerminal = { resourceId: resource.id, sessionId: resource.sessionId }
  return { ...tab, ...activeTerminal }
}

let activeTerminal = null

async function typeInTerminal(text) {
  assert.ok(activeTerminal, 'an active terminal should exist')
  await evaluate(
    `window.bridge.invoke('terminal:write', ${JSON.stringify(activeTerminal.sessionId)}, ` +
      `${activeTerminal.resourceId}, ${JSON.stringify(`${text}\r`)})`
  )
}

async function pressCtrlC() {
  assert.ok(activeTerminal, 'an active terminal should exist')
  await evaluate(
    `window.bridge.invoke('terminal:write', ${JSON.stringify(activeTerminal.sessionId)}, ` +
      `${activeTerminal.resourceId}, '\\u0003')`
  )
}

async function pasteInTerminal(text) {
  await typeInTerminal(text)
}

async function resizeWorkbench() {
  const sash = await evaluate(`(() => {
    const element = document.querySelector(
      '.larify-workbench-resize-handle'
    )
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert.ok(sash, 'workbench resize handle should exist')
  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    clickCount: 1,
    type: 'mousePressed',
    ...sash
  })
  await send('Input.dispatchMouseEvent', {
    buttons: 1,
    type: 'mouseMoved',
    x: sash.x - 80,
    y: sash.y
  })
  await send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    clickCount: 1,
    type: 'mouseReleased',
    x: sash.x - 80,
    y: sash.y
  })
}

async function terminalSnapshot(tab) {
  return evaluate(
    `window.bridge.invoke('terminal:snapshot', ${JSON.stringify(tab.sessionId)}, ${tab.resourceId})`
  )
}

const terminalText = (text) =>
  `document.querySelector('[data-terminal-active="true"] .xterm-rows')?.textContent.includes(${JSON.stringify(text)})`

async function runAndWait(command, expected, message, timeout) {
  await typeInTerminal(command)
  await waitFor(
    `(async () => (await window.bridge.invoke(
      'terminal:snapshot', ${JSON.stringify(activeTerminal.sessionId)}, ${activeTerminal.resourceId}
    ))?.data.includes(${JSON.stringify(expected)}))()`,
    `${message} snapshot`,
    timeout
  )
  await waitFor(terminalText(expected), message, timeout)
}

function shellCommand(title, commands) {
  if (title === 'PowerShell') return commands.powerShell
  if (title === 'CMD') return commands.cmd
  return commands.posix
}

async function closeTab(id, resourceId) {
  const clicked = await evaluate(`(() => {
    const button = document.querySelector(
      '.larify-workbench-tab[data-tab-id="${id}"] .larify-workbench-tab-close'
    )
    button?.click()
    return Boolean(button)
  })()`)
  assert.equal(clicked, true, `tab ${id} close button should exist`)
  await waitFor(
    `!document.querySelector('.larify-workbench-tab[data-tab-id="${id}"]')`,
    `tab ${id} close`
  )
  await waitFor(
    `(async () => !(await window.bridge.invoke('resource:list')).some(({ id }) => id === ${resourceId}))()`,
    `resource ${resourceId} close`
  )
}

await waitFor(
  `Boolean(window.bridge && document.querySelector('[aria-label="显示工作台"], [aria-label="隐藏工作台"]'))`,
  'renderer ready',
  10_000
)

const initialResources = await evaluate(`window.bridge.invoke('resource:list')`)
const createdTabs = []

try {
  const first = await createTerminal()
  createdTabs.push(first)
  assert.match(first.title, /^(PowerShell|CMD|Bash|Zsh)$/)

  const marker = `LARIFY_USER_CDP_${Date.now()}`
  await runAndWait(
    shellCommand(first.title, {
      cmd: `echo ${marker}`,
      posix: `printf '%s\\n' '${marker}'`,
      powerShell: `Write-Output "${marker}"`
    }),
    marker,
    'basic command output'
  )

  const unicodeMarker = `终端中文_${Date.now()}`
  await runAndWait(
    shellCommand(first.title, {
      cmd: `echo ${unicodeMarker}`,
      posix: `printf '%s\\n' '${unicodeMarker}'`,
      powerShell: `Write-Output "${unicodeMarker}"`
    }),
    unicodeMarker,
    'Unicode command output'
  )

  const pasteMarker = `LARIFY_PASTE_中文_${Date.now()}`
  await pasteInTerminal(
    shellCommand(first.title, {
      cmd: `echo ${pasteMarker}`,
      posix: `printf '%s\\n' '${pasteMarker}'`,
      powerShell: `Write-Output "${pasteMarker}"`
    })
  )
  await waitFor(terminalText(pasteMarker), 'clipboard paste output')

  const errorMarker = `LARIFY_ERROR_${Date.now()}`
  await runAndWait(
    shellCommand(first.title, {
      cmd: `echo ${errorMarker} 1>&2`,
      posix: `printf '%s\\n' '${errorMarker}' >&2`,
      powerShell: `Write-Error "${errorMarker}"`
    }),
    errorMarker,
    'error stream output'
  )

  const firstSequence = `LARIFY_SEQUENCE_A_${Date.now()}`
  const secondSequence = `LARIFY_SEQUENCE_B_${Date.now()}`
  await runAndWait(
    shellCommand(first.title, {
      cmd: `echo ${firstSequence} & echo ${secondSequence}`,
      posix: `printf '%s\\n' '${firstSequence}' '${secondSequence}'`,
      powerShell: `Write-Output "${firstSequence}"; Write-Output "${secondSequence}"`
    }),
    secondSequence,
    'sequential command output'
  )

  const bulkPrefix = `LARIFY_OVERFLOW_${Date.now()}`
  const bulkFirst = `${bulkPrefix}_FIRST`
  const bulkMarker = `${bulkPrefix}_END`
  await runAndWait(
    shellCommand(first.title, {
      cmd: `echo ${bulkFirst} & for /L %i in (1,1,6500) do @echo ${bulkPrefix}_%i & echo ${bulkPrefix}_EN^D`,
      posix: `echo '${bulkFirst}'; for i in $(seq 1 6500); do echo ${bulkPrefix}_$i; done; printf '%s%s\n' '${bulkPrefix}_' 'END'`,
      powerShell: `Write-Output "${bulkFirst}"; 1..6500 | ForEach-Object { "${bulkPrefix}_$_" }; Write-Output ("${bulkPrefix}_" + "END")`
    }),
    bulkMarker,
    'output beyond the terminal scrollback limit',
    20_000
  )
  const overflowSnapshot = await evaluate(
    `window.bridge.invoke('terminal:snapshot', ${JSON.stringify(first.sessionId)}, ${first.resourceId})`
  )
  assert.ok(overflowSnapshot.data.includes(bulkMarker), 'snapshot should retain the output tail')
  await waitFor(terminalText(bulkMarker), 'large output rendered in terminal', 20_000)
  await evaluate(`(() => {
    const viewport = document.querySelector('.xterm-viewport')
    if (!viewport) return false
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event('scroll'))
    return true
  })()`)
  await wait(100)
  assert.equal(
    await evaluate(terminalText(bulkFirst)),
    false,
    'renderer should evict output beyond the 5000-line scrollback limit'
  )
  await evaluate(`(() => {
    const viewport = document.querySelector('.xterm-viewport')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  })()`)

  const interruptedMarker = `LARIFY_INTERRUPTED_${Date.now()}`
  const shouldNotPrint = `LARIFY_UNEXPECTED_${Date.now()}`
  await typeInTerminal(
    shellCommand(first.title, {
      cmd: `ping 127.0.0.1 -n 20 >nul & echo ${shouldNotPrint}`,
      posix: `sleep 20; echo '${shouldNotPrint}'`,
      powerShell: `Start-Sleep -Seconds 20; Write-Output "${shouldNotPrint}"`
    })
  )
  await wait(300)
  await pressCtrlC()
  await wait(300)
  await runAndWait(
    shellCommand(first.title, {
      cmd: `echo ${interruptedMarker}`,
      posix: `echo '${interruptedMarker}'`,
      powerShell: `Write-Output "${interruptedMarker}"`
    }),
    interruptedMarker,
    'command after interrupt'
  )
  assert.equal(await evaluate(terminalText(shouldNotPrint)), false)

  const sizeBefore = await terminalSnapshot(first)
  assert.ok(sizeBefore, 'terminal snapshot should exist before resizing')
  await resizeWorkbench()
  const sizeAfter = await waitFor(
    `(async () => {
      const snapshot = await window.bridge.invoke(
        'terminal:snapshot', ${JSON.stringify(first.sessionId)}, ${first.resourceId}
      )
      return snapshot && (snapshot.cols !== ${sizeBefore.cols} || snapshot.rows !== ${sizeBefore.rows})
        ? snapshot
        : null
    })()`,
    'terminal dimensions after workbench resize'
  )
  assert.ok(sizeAfter.cols > 0 && sizeAfter.rows > 0)

  const second = await createTerminal()
  createdTabs.push(second)
  assert.notEqual(second.id, first.id)

  const secondMarker = `LARIFY_SECOND_TERMINAL_${Date.now()}`
  await runAndWait(
    shellCommand(second.title, {
      cmd: `echo ${secondMarker}`,
      posix: `echo '${secondMarker}'`,
      powerShell: `Write-Output "${secondMarker}"`
    }),
    secondMarker,
    'second terminal output'
  )

  await clickSelector(
    `.larify-workbench-tab[data-tab-id="${first.id}"] .larify-workbench-tab-trigger`
  )
  activeTerminal = first
  await waitFor(
    `Boolean(document.querySelector(
      '.larify-workbench-tab[data-tab-id="${first.id}"] [data-state="active"]'
    ))`,
    'first terminal tab selection'
  )
  await waitFor(terminalText(interruptedMarker), 'terminal snapshot restoration')
  assert.equal(await evaluate(terminalText(secondMarker)), false, 'terminal output must not leak')

  await clickSelector(
    `.larify-workbench-tab[data-tab-id="${second.id}"] .larify-workbench-tab-trigger`
  )
  activeTerminal = second
  await waitFor(terminalText(secondMarker), 'second terminal isolation')
  await typeInTerminal('exit')
  await waitFor(
    `!document.querySelector('.larify-workbench-tab[data-tab-id="${second.id}"]')`,
    'terminal tab removal after shell exit'
  )
  await waitFor(
    `(async () => !(await window.bridge.invoke('resource:list')).some(({ id }) => id === ${second.resourceId}))()`,
    'terminal resource removal after shell exit'
  )
  createdTabs.splice(
    createdTabs.findIndex(({ id }) => id === second.id),
    1
  )

  const streaming = await createTerminal()
  createdTabs.push(streaming)
  const streamingMarker = `LARIFY_STREAMING_${Date.now()}`
  await typeInTerminal(
    shellCommand(streaming.title, {
      cmd: `ping -t 127.0.0.1`,
      posix: `while true; do echo '${streamingMarker}'; sleep 0.05; done`,
      powerShell: `while ($true) { Write-Output "${streamingMarker}"; Start-Sleep -Milliseconds 50 }`
    })
  )
  if (streaming.title !== 'CMD') {
    await waitFor(terminalText(streamingMarker), 'continuous terminal output')
  } else {
    await waitFor(terminalText('127.0.0.1'), 'continuous terminal output')
  }
  await closeTab(streaming.id, streaming.resourceId)
  createdTabs.splice(
    createdTabs.findIndex(({ id }) => id === streaming.id),
    1
  )

  for (let index = 0; index < 3; index += 1) {
    const transient = await createTerminal()
    createdTabs.push(transient)
    await closeTab(transient.id, transient.resourceId)
    createdTabs.splice(
      createdTabs.findIndex(({ id }) => id === transient.id),
      1
    )
  }

  console.log(
    JSON.stringify(
      {
        commands: [
          'basic',
          'unicode',
          'clipboard',
          'stderr',
          'sequence',
          'overflow',
          'interrupt',
          'exit',
          'close-while-streaming',
          'rapid-create-close'
        ],
        resizedFrom: [sizeBefore.cols, sizeBefore.rows],
        resizedTo: [sizeAfter.cols, sizeAfter.rows],
        resourcesCreated: 6,
        title: first.title
      },
      null,
      2
    )
  )
} finally {
  for (const tab of [...createdTabs].reverse()) {
    await closeTab(tab.id, tab.resourceId).catch(() => undefined)
  }
  const remaining = await evaluate(`window.bridge.invoke('resource:list')`)
  const initialIds = new Set(initialResources.map(({ id }) => id))
  for (const resource of remaining) {
    if (!initialIds.has(resource.id)) {
      await evaluate(`window.bridge.invoke('resource:close', ${resource.id})`).catch(
        () => undefined
      )
    }
  }
  await waitFor(
    `(async () => JSON.stringify(await window.bridge.invoke('resource:list')) === ${JSON.stringify(JSON.stringify(initialResources))})()`,
    'resource cleanup'
  )
  socket.close()
}
