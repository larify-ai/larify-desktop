/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../manual/cdp-client.mjs'

const cdp = await connectLarifyCdp()
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const evaluate = (body) => cdp.evaluate(`(() => { ${body} })()`)
let renamedSession = null

const openContextMenu = async (selector) => {
  const opened = await evaluate(`
    const target = document.querySelector(${JSON.stringify(selector)})
    if (!target) return false
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + 12,
      clientY: rect.top + rect.height / 2
    }))
    return true
  `)
  assert.equal(opened, true, `context menu target should exist: ${selector}`)
  await wait(150)
}

const chooseMenuItem = async (label) => {
  const selected = await evaluate(`
    const item = [...document.querySelectorAll('[data-slot="context-menu-item"]')]
      .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(label)})
    if (!item) return false
    item.click()
    return true
  `)
  assert.equal(selected, true, `context menu item should exist: ${label}`)
  await wait(150)
}

const openWorkspaceContextMenu = async (cwd) => {
  const opened = await evaluate(`
    const section = [...document.querySelectorAll('section[data-workspace-id]')]
      .find((candidate) => candidate.dataset.workspaceId === ${JSON.stringify(cwd)})
    const target = section?.firstElementChild
    if (!target) return false
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + 12,
      clientY: rect.top + rect.height / 2
    }))
    return true
  `)
  assert.equal(opened, true, `workspace context menu target should exist: ${cwd}`)
  await wait(150)
}

const originalHidden = await cdp.evaluate(`localStorage.getItem('larify:hidden-workspaces')`)

try {
  const addButton = '[aria-label="添加工作空间"]'
  const heading = '#workspaces-heading'
  const initialOpacity = await evaluate(`
    document.activeElement?.blur()
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: innerWidth - 2, clientY: 2 }))
    const button = document.querySelector(${JSON.stringify(addButton)})
    return button ? getComputedStyle(button).opacity : null
  `)
  assert.equal(initialOpacity, '0', 'add workspace action should be hidden initially')

  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId: headingNodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: heading
  })
  assert.ok(headingNodeId, 'workspace heading should exist')
  await cdp.send('CSS.enable')
  await cdp.send('CSS.forcePseudoState', {
    nodeId: headingNodeId,
    forcedPseudoClasses: ['hover']
  })
  await wait(150)
  const hoverState = await evaluate(`
      const button = document.querySelector(${JSON.stringify(addButton)})
      const heading = document.querySelector(${JSON.stringify(heading)})
      return {
        opacity: button ? getComputedStyle(button).opacity : null,
        headingHovered: heading?.matches(':hover') ?? false,
        headingClass: heading?.className ?? null,
        buttonClass: button?.className ?? null
      }
    `)
  assert.ok(
    Number(hoverState.opacity) > 0.95,
    `add workspace action should appear on heading hover: ${JSON.stringify(hoverState)}`
  )
  await cdp.send('CSS.forcePseudoState', {
    nodeId: headingNodeId,
    forcedPseudoClasses: []
  })
  const target = await evaluate(`
    const section = [...document.querySelectorAll('section[data-workspace-id]')]
      .find((candidate) => candidate.dataset.workspaceId && candidate.querySelector('[data-session-id]'))
    const session = section?.querySelector('[data-session-id]')
    return section && session ? {
      cwd: section.dataset.workspaceId,
      sessionId: session.dataset.sessionId,
      title: session.textContent.trim()
    } : null
  `)
  assert.ok(target, 'a persisted session in a removable workspace is required')
  renamedSession = target

  const sessionSelector = `[data-session-id="${target.sessionId}"]`
  await openContextMenu(sessionSelector)
  await chooseMenuItem('重命名任务')
  assert.equal(
    await evaluate(
      `return document.querySelector(${JSON.stringify(sessionSelector)})?.querySelector('input[aria-label="任务名称"]') !== null`
    ),
    true,
    'rename should use an inline input'
  )
  assert.equal(
    await cdp.evaluate(`document.activeElement?.getAttribute('aria-label') === '任务名称'`),
    true,
    'inline rename should receive keyboard focus without a second click'
  )
  assert.deepEqual(
    await cdp.evaluate(`(() => {
      const input = document.activeElement
      return input?.getAttribute('aria-label') === '任务名称'
        ? { start: input.selectionStart, end: input.selectionEnd, length: input.value.length }
        : null
    })()`),
    { start: target.title.length, end: target.title.length, length: target.title.length },
    'inline rename should show a collapsed caret at the end instead of selecting the title'
  )

  const temporaryTitle = `${target.title} · CDP`
  assert.equal(
    await evaluate(`
    const input = document.querySelector(${JSON.stringify(sessionSelector)})?.querySelector('input')
    if (!input) return false
    input.select()
    return true
  `),
    true
  )
  await cdp.send('Input.insertText', { text: temporaryTitle })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })
  await wait(300)
  assert.equal(
    await cdp.evaluate(`window.bridge.invoke('session:list', ${JSON.stringify(target.cwd)}, 0, 1000)
      .then((sessions) => sessions.find(({ id }) => id === ${JSON.stringify(target.sessionId)})?.title)`),
    temporaryTitle,
    'inline rename should persist through IPC'
  )

  await openContextMenu(sessionSelector)
  await chooseMenuItem('重命名任务')
  assert.equal(
    await evaluate(`
    const input = document.querySelector(${JSON.stringify(sessionSelector)})?.querySelector('input')
    if (!input) return false
    input.focus()
    input.select()
    return true
  `),
    true
  )
  await cdp.send('Input.insertText', { text: target.title })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })
  await wait(300)
  assert.equal(
    await cdp.evaluate(`window.bridge.invoke('session:list', ${JSON.stringify(target.cwd)}, 0, 1000)
      .then((sessions) => sessions.find(({ id }) => id === ${JSON.stringify(target.sessionId)})?.title)`),
    target.title,
    'CDP should restore the original title after validating rename'
  )

  await openWorkspaceContextMenu(target.cwd)
  await chooseMenuItem('移除工作空间')
  assert.equal(
    await evaluate(`return [...document.querySelectorAll('section[data-workspace-id]')]
      .every((candidate) => candidate.dataset.workspaceId !== ${JSON.stringify(target.cwd)})`),
    true,
    'removed workspace should disappear from navigation'
  )
  assert.equal(
    await cdp.evaluate(`JSON.parse(localStorage.getItem('larify:hidden-workspaces') ?? '[]')
      .includes(${JSON.stringify(target.cwd)})`),
    true,
    'removed workspace should be persisted as hidden'
  )

  const defaultWorkspaceExists = await cdp.evaluate(
    `document.querySelector('section[data-workspace-id=""]') !== null`
  )
  if (defaultWorkspaceExists) {
    await openWorkspaceContextMenu('')
    assert.equal(
      await cdp.evaluate(`[...document.querySelectorAll('[data-slot="context-menu-item"]')]
        .some((item) => item.textContent.trim() === '移除工作空间')`),
      false,
      'default workspace must not expose a remove action'
    )
  }

  console.log(JSON.stringify({ target, temporaryTitle, defaultWorkspaceExists }, null, 2))
} finally {
  if (renamedSession) {
    await cdp.evaluate(
      `window.bridge.invoke('session:rename', ${JSON.stringify(renamedSession.sessionId)}, ${JSON.stringify(renamedSession.title)})`
    )
  }
  await cdp.evaluate(`(() => {
    const value = ${JSON.stringify(originalHidden)}
    if (value === null) localStorage.removeItem('larify:hidden-workspaces')
    else localStorage.setItem('larify:hidden-workspaces', value)
    location.reload()
  })()`)
  cdp.close()
}
