/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const marker = `LARIFY_DURATION_CDP_${Date.now()}`
const prompt =
  process.env.LARIFY_DURATION_PROMPT ??
  `Use an available tool exactly once, then reply with only ${marker}. Do not ask questions.`

const waitFor = async (expression, label, timeout = 300_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(100)
  }
  throw new Error(`Timed out: ${label}`)
}

const durationLabelExpression = `(() => {
  const labels = [...document.querySelectorAll('button')]
    .filter((candidate) => candidate.getClientRects().length > 0)
    .map((candidate) => candidate.textContent?.trim() ?? '')
  return labels.find((text) => /^已完成 · 处理了 \\d+(?:分钟 \\d+)?秒$/.test(text)) ?? null
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

  await waitFor(
    `Boolean(document.querySelector('button[aria-label="停止"]'))`,
    'agent start',
    30_000
  )
  await waitFor(
    `[...document.querySelectorAll('.is-assistant')].some((node) =>
      node.textContent?.includes(${JSON.stringify(marker)}))`,
    'assistant marker'
  )

  const sessionId = await waitFor(
    `(async () => {
      const sessions = await window.bridge.invoke('session:list', '', 0, 50)
      for (const session of sessions) {
        const messages = await window.bridge.invoke('session:msgs', session.id)
        if (messages.some(({ parts = [] }) => parts.some(({ text }) =>
          typeof text === 'string' && text.includes(${JSON.stringify(marker)})
        ))) return session.id
      }
      return null
    })()`,
    'persisted test session',
    30_000
  )

  const liveLabel = await waitFor(durationLabelExpression, 'live duration label')
  const persistedMetadata = await evaluate(`(async () => {
    const messages = await window.bridge.invoke('session:msgs', ${JSON.stringify(sessionId)})
    const response = messages.findLast(({ role, parts = [] }) =>
      role === 'assistant' && parts.some(({ text }) =>
        typeof text === 'string' && text.includes(${JSON.stringify(marker)})
      )
    )
    return response?.metadata ?? null
  })()`)

  assert.equal(typeof persistedMetadata?.startedAt, 'number', 'persisted response needs startedAt')
  assert.equal(
    typeof persistedMetadata?.completedAt,
    'number',
    'persisted response needs completedAt before reload'
  )
  assert.notEqual(persistedMetadata?.outcome, 'aborted', 'completed response must not be aborted')
  assert.ok(
    persistedMetadata.completedAt >= persistedMetadata.startedAt,
    'completedAt must not precede startedAt'
  )

  await cdp.send('Page.reload', { ignoreCache: true })
  await waitFor(
    `(() => {
      const button = [...document.querySelectorAll('button[data-session-id]')]
        .find((candidate) => candidate.dataset.sessionId === ${JSON.stringify(sessionId)})
      button?.click()
      return Boolean(button)
    })()`,
    'persisted session after reload',
    30_000
  )
  await waitFor(
    `[...document.querySelectorAll('.is-assistant')].some((node) =>
      node.textContent?.includes(${JSON.stringify(marker)}))`,
    'persisted assistant marker',
    30_000
  )
  const reloadedLabel = await waitFor(durationLabelExpression, 'reloaded duration label', 10_000)

  assert.equal(reloadedLabel, liveLabel, 'duration label should survive a page reload')
  console.log(
    JSON.stringify({ liveLabel, marker, persistedMetadata, reloadedLabel, sessionId }, null, 2)
  )
} finally {
  cdp.close()
}
