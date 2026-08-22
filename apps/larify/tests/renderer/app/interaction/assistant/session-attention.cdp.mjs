/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'

const cdp = await connectLarifyCdp()
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFor = async (expression, label, timeout = 300_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await cdp.evaluate(expression)
    if (value) return value
    await wait(100)
  }
  throw new Error(`Timed out: ${label}`)
}
const clickNewTask = () =>
  waitFor(
    `(() => {
      const button = document.querySelector('.lucide-message-circle-plus')?.closest('button')
      button?.click()
      return Boolean(button)
    })()`,
    'new task button',
    10_000
  )
const submit = async (prompt) => {
  const submitted = await waitFor(
    `(() => {
      const textarea = [...document.querySelectorAll('form textarea')].find(
        (candidate) => !candidate.classList.contains('xterm-helper-textarea') && candidate.offsetParent
      )
      if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled) return false
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        textarea,
        ${JSON.stringify(prompt)}
      )
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      textarea.closest('form')?.requestSubmit()
      return true
    })()`,
    'assistant composer',
    10_000
  )
  assert.equal(submitted, true)
}
const indicatorCount = (label) =>
  cdp.evaluate(`document.querySelectorAll(${JSON.stringify(`[aria-label="${label}"]`)}).length`)

try {
  await cdp.send('Page.bringToFront')
  await clickNewTask()
  await submit('Reply with only: attention-state-cdp-complete')
  await waitFor(
    `Boolean(document.querySelector('[aria-label="执行中"]'))`,
    'active indicator',
    30_000
  )

  await clickNewTask()
  assert.ok((await indicatorCount('执行中')) > 0, 'background task should remain active')
  await waitFor(`Boolean(document.querySelector('[aria-label="有新消息"]'))`, 'unread indicator')
  const unreadAppearance = await cdp.evaluate(`(() => {
    const indicator = document.querySelector('[aria-label="有新消息"]')
    if (!indicator) return null
    const rect = indicator.getBoundingClientRect()
    const style = getComputedStyle(indicator)
    return {
      width: rect.width,
      height: rect.height,
      backgroundColor: style.backgroundColor,
      visibility: style.visibility,
      opacity: style.opacity
    }
  })()`)
  assert.equal(unreadAppearance?.width, 8)
  assert.equal(unreadAppearance?.height, 8)
  assert.notEqual(unreadAppearance?.backgroundColor, 'rgba(0, 0, 0, 0)')
  assert.equal(unreadAppearance?.visibility, 'visible')
  assert.equal(unreadAppearance?.opacity, '1')

  const unreadSelected = await cdp.evaluate(`(() => {
    const indicator = document.querySelector('[aria-label="有新消息"]')
    const button = indicator?.closest('button')
    button?.click()
    return Boolean(button)
  })()`)
  assert.equal(unreadSelected, true)
  await waitFor(`!document.querySelector('[aria-label="有新消息"]')`, 'unread cleared', 10_000)

  await clickNewTask()
  await submit(
    'Call agent_ask_user now and ask me to choose between A and B. Do not answer it yourself.'
  )
  await waitFor(`Boolean(document.querySelector('[aria-label="等待处理"]'))`, 'waiting indicator')
  await clickNewTask()
  assert.ok((await indicatorCount('等待处理')) > 0, 'background task should remain waiting')
  const alignment = await cdp.evaluate(`(() => {
    const indicator = document.querySelector('[aria-label="等待处理"]')
    const create = [...document.querySelectorAll('button[aria-label$="中新建任务"]')].find(
      (button) => button.offsetParent
    )
    if (!indicator || !create) return null
    const indicatorRect = indicator.getBoundingClientRect()
    const createRect = create.getBoundingClientRect()
    const title = indicator.closest('button')?.querySelector('span[style*="mask-image"]')
    const titleRect = title?.getBoundingClientRect()
    return {
      indicatorX: indicatorRect.left + indicatorRect.width / 2,
      createX: createRect.left + createRect.width / 2,
      titleRight: titleRect?.right ?? null,
      indicatorLeft: indicatorRect.left,
      titleMask: title ? getComputedStyle(title).maskImage : null
    }
  })()`)
  assert.ok(alignment, 'status indicator and workspace action should be measurable')
  assert.ok(
    Math.abs(alignment.indicatorX - alignment.createX) < 0.5,
    'status indicator should align vertically with the workspace add action'
  )
  assert.ok(alignment.titleRight <= alignment.indicatorLeft, 'title should stop before the status')
  assert.notEqual(alignment.titleMask, 'none', 'overflowing titles should fade before the status')

  console.log('session attention CDP regression passed')
} finally {
  cdp.close()
}
