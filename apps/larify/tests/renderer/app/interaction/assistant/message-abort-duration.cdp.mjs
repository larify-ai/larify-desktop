/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const marker = `LARIFY_ABORT_DURATION_CDP_${Date.now()}`
const prompt =
  process.env.LARIFY_ABORT_DURATION_PROMPT ??
  `Use the terminal to run a command that prints ${marker} once per second for 60 seconds. Do not finish or reply before the command completes.`

const waitFor = async (expression, label, timeout = 60_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(100)
  }
  throw new Error(`Timed out: ${label}`)
}

const abortedLabelExpression = String.raw`(() => {
  const labels = [...document.querySelectorAll('button, .is-assistant div')]
    .filter((candidate) => candidate.getClientRects().length > 0)
    .map((candidate) => candidate.textContent?.trim() ?? '')
  return labels.find((text) => /^已中断 · 处理了 \d+(?:分钟 \d+)?秒$/.test(text)) ?? null
})()`
const liveExpandedExpression = String.raw`(() => {
  const button = [...document.querySelectorAll('button')].find((candidate) =>
    /^处理了 \d+(?:分钟 \d+)?秒$/.test(candidate.textContent?.trim() ?? '')
  )
  return button?.getAttribute('aria-expanded') === 'true'
})()`
const abortedCollapsedExpression = String.raw`(() => {
  const button = [...document.querySelectorAll('button')].find((candidate) =>
    /^已中断 · 处理了 \d+(?:分钟 \d+)?秒$/.test(candidate.textContent?.trim() ?? '')
  )
  return button?.getAttribute('aria-expanded') === 'false'
})()`

try {
  await cdp.send('Page.bringToFront')
  await waitFor(
    `(() => {
      const button = document.querySelector('.lucide-message-circle-plus')?.closest('button')
      button?.click()
      return Boolean(button)
    })()`,
    'new task button',
    10_000
  )
  await waitFor(
    `(() => {
      const textarea = [...document.querySelectorAll('form textarea')]
        .find((candidate) =>
          !candidate.classList.contains('xterm-helper-textarea') &&
          candidate.getClientRects().length > 0
        )
      return Boolean(textarea && !textarea.disabled && textarea.getClientRects().length > 0)
    })()`,
    'assistant composer',
    10_000
  )

  const submitted = await evaluate(`(() => {
    const textarea = [...document.querySelectorAll('form textarea')]
      .find((candidate) =>
        !candidate.classList.contains('xterm-helper-textarea') &&
        candidate.getClientRects().length > 0
      )
    if (!(textarea instanceof HTMLTextAreaElement)) return false
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      textarea,
      ${JSON.stringify(prompt)}
    )
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    textarea.closest('form')?.requestSubmit()
    return true
  })()`)
  assert.equal(submitted, true, 'prompt should be submitted through the assistant UI')

  await waitFor(`Boolean(document.querySelector('button[aria-label="停止"]'))`, 'agent start')
  await waitFor(liveExpandedExpression, 'expanded live activity')
  await wait(2_000)
  const stopped = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="停止"]')
    if (!(button instanceof HTMLButtonElement)) return false
    button.click()
    return true
  })()`)
  assert.equal(stopped, true, 'stop button should be clicked')
  await waitFor(`!document.querySelector('button[aria-label="停止"]')`, 'agent stop')

  const liveLabel = await waitFor(abortedLabelExpression, 'aborted duration label', 10_000)
  assert.doesNotMatch(liveLabel, /已完成/, 'an interrupted response must not look completed')
  await waitFor(abortedCollapsedExpression, 'collapsed interrupted activity', 10_000)

  const sessionId = await waitFor(
    `(async () => {
      const sessions = await window.bridge.invoke('session:list', '', 0, 50)
      for (const session of sessions) {
        const messages = await window.bridge.invoke('session:msgs', session.id)
        if (messages.some(({ role, parts = [] }) => role === 'user' && parts.some(({ text }) =>
          typeof text === 'string' && text.includes(${JSON.stringify(marker)})
        ))) return session.id
      }
      return null
    })()`,
    'persisted interrupted session',
    30_000
  )
  const persistedMetadata = await waitFor(
    `(async () => {
      const messages = await window.bridge.invoke('session:msgs', ${JSON.stringify(sessionId)})
      const response = messages.findLast(({ role }) => role === 'assistant')
      return response?.metadata?.outcome === 'aborted' ? response.metadata : null
    })()`,
    'persisted aborted metadata',
    30_000
  )
  assert.equal(typeof persistedMetadata.startedAt, 'number')
  assert.equal(typeof persistedMetadata.completedAt, 'number')
  assert.ok(persistedMetadata.completedAt >= persistedMetadata.startedAt)

  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor(
    `(() => {
      const button = [...document.querySelectorAll('button[data-session-id]')]
        .find((candidate) => candidate.dataset.sessionId === ${JSON.stringify(sessionId)})
      button?.click()
      return Boolean(button)
    })()`,
    'interrupted session after reload',
    30_000
  )
  const reloadedLabel = await waitFor(abortedLabelExpression, 'reloaded aborted label', 10_000)
  assert.equal(reloadedLabel, liveLabel, 'interrupted duration should survive reload')

  console.log(
    JSON.stringify({ liveLabel, marker, persistedMetadata, reloadedLabel, sessionId }, null, 2)
  )
} finally {
  cdp.close()
}
