/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../manual/cdp-client.mjs'

const cdp = await connectLarifyCdp()
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const clickPoint = async (point) => {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...point
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...point
  })
}
const actionOpacity = (label) =>
  cdp.evaluate(`(() => {
    const action = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})
    return action ? getComputedStyle(action).opacity : null
  })()`)
const actionPoint = (label) =>
  cdp.evaluate(`(() => {
    const action = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})
    if (!action) return null
    const rect = action.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
const hoverAction = async (label) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const point = await actionPoint(label)
    assert.ok(point, `workspace action should exist: ${label}`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await wait(100)
    if ((await actionOpacity(label)) === '1') return point
  }
  assert.fail(`workspace action should become visible: ${label}`)
}
const measure = () =>
  cdp.evaluate(`(() => {
    const heading = document.querySelector('#workspaces-heading')
    const currentWorkspace = [...document.querySelectorAll('button[data-slot="dropdown-menu-trigger"]')]
      .find((button) => button.offsetParent && button.title)?.textContent.trim()
    const workspaceList = document.querySelector('nav[aria-labelledby="workspaces-heading"]')
    const listRect = workspaceList?.getBoundingClientRect()
    const workspaceAction = [...document.querySelectorAll('button[aria-label$="中新建任务"]')]
      .find((button) => {
        const rect = button.getBoundingClientRect()
        return button.offsetParent && listRect && rect.top >= listRect.top && rect.bottom <= listRect.bottom &&
          !button.getAttribute('aria-label')?.includes(currentWorkspace)
      })
    if (!heading || !workspaceAction || !workspaceList) return null
    const workspaceRect = workspaceAction.getBoundingClientRect()
    return {
      workspaceName: workspaceAction.getAttribute('aria-label')?.match(/^在 (.*) 中新建任务$/)?.[1],
      workspaceLabel: workspaceAction.getAttribute('aria-label'),
      headingTop: heading.getBoundingClientRect().top,
      outsidePoint: { x: innerWidth - 2, y: 2 },
      workspaceOpacity: getComputedStyle(workspaceAction).opacity,
      workspacePoint: { x: workspaceRect.left + workspaceRect.width / 2, y: workspaceRect.top + workspaceRect.height / 2 },
      workspaceScrollTop: workspaceList.scrollTop
    }
  })()`)
try {
  const newTaskPoint = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.trim() === '新建任务')
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert.ok(newTaskPoint, 'global new task action should be visible')
  await clickPoint(newTaskPoint)
  await wait(300)
  assert.equal(
    await cdp.evaluate(
      "[...document.querySelectorAll('textarea')].some((input) => input.offsetParent && input.placeholder === '描述任务...')"
    ),
    true,
    'global new task action should keep the composer visible'
  )
  await cdp.evaluate(`(() => {
    const list = document.querySelector('nav[aria-labelledby="workspaces-heading"]')
    if (list) list.scrollTop = 0
  })()`)
  await wait(100)

  const position = await measure()
  assert.ok(position, 'workspace navigation should be visible')
  await cdp.evaluate('document.activeElement?.blur()')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position.outsidePoint })
  await wait(300)
  const initial = await measure()
  assert.ok(initial, 'workspace navigation should be visible')
  assert.equal(initial.workspaceOpacity, '0')

  const hoveredPoint = await hoverAction(initial.workspaceLabel)
  assert.equal(await actionOpacity(initial.workspaceLabel), '1')

  await clickPoint(hoveredPoint)
  await wait(300)
  const clickedActionExists = await cdp.evaluate(
    `document.querySelector(${JSON.stringify(`[aria-label="${initial.workspaceLabel}"]`)}) !== null`
  )
  assert.equal(clickedActionExists, false)
  const composerWorkspace = await cdp.evaluate(`(() => {
    const triggers = [...document.querySelectorAll('button[data-slot="dropdown-menu-trigger"]')]
      .filter((button) => button.offsetParent && button.title)
    return triggers.find((button) => button.textContent.trim() === ${JSON.stringify(initial.workspaceName)})
      ?.textContent.trim() ?? null
  })()`)
  assert.equal(composerWorkspace, initial.workspaceName)

  await cdp.evaluate(`(() => {
    const list = document.querySelector('nav[aria-labelledby="workspaces-heading"]')
    list.scrollTop = list.scrollHeight
  })()`)
  await wait(100)
  const scrolled = await measure()
  assert.equal(scrolled.headingTop, initial.headingTop)
  assert.ok(scrolled.workspaceScrollTop >= initial.workspaceScrollTop)

  console.log(JSON.stringify({ initial, scrolled }, null, 2))
} finally {
  cdp.close()
}
