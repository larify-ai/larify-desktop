/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
// Keep the assertion marker Markdown-neutral. An incomplete `_..._` sequence is
// intentionally not guaranteed to have visible text while Streamdown repairs it.
const marker = `LarifyFinalReplay${Date.now()}ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`

const waitFor = async (expression, label, timeout = 120_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(20)
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  })
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
    `Boolean([...document.querySelectorAll('form textarea')].find((candidate) =>
      !candidate.classList.contains('xterm-helper-textarea') && candidate.getClientRects().length > 0
    ))`,
    'assistant composer',
    10_000
  )

  const submitted = await evaluate(`(() => {
    const textarea = [...document.querySelectorAll('form textarea')].find((candidate) =>
      !candidate.classList.contains('xterm-helper-textarea') && candidate.getClientRects().length > 0
    )
    if (!(textarea instanceof HTMLTextAreaElement)) return false
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      textarea,
      ${JSON.stringify(`Use exactly one available tool to list the current working directory. Regardless of the result, do not ask a question and then reply with only ${marker}`)}
    )
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    textarea.closest('form')?.requestSubmit()
    return true
  })()`)
  assert.equal(submitted, true, 'prompt should be submitted through the assistant UI')

  await waitFor(`Boolean(document.querySelector('button[aria-label="停止"]'))`, 'agent start', 30_000)
  await waitFor(`Boolean(document.querySelector('[data-activity-group]'))`, 'streaming processing area')
  await waitFor(
    `Boolean(document.querySelector('[data-activity-kind="tool-group"]'))`,
    'streaming tool card'
  )
  await waitFor(
    `Boolean(document.querySelector('[data-shimmer-content]'))`,
    'streaming activity title',
    10_000
  )
  assert.equal(
    await evaluate(`Boolean(document.querySelector('[data-final-answer-replay]'))`),
    false,
    'final answer must not render outside processing while the agent is running'
  )
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-shimmer-content]').length`),
    1,
    'only the latest processing item should shimmer'
  )
  assert.equal(
    await evaluate(
      `!document.querySelector('[data-shimmer-content]')?.querySelector('svg') &&
       Boolean(document.querySelector('[data-shimmer-content]')?.parentElement?.querySelector('svg'))`
    ),
    true,
    'the live icon should remain static beside the shimmering title'
  )
  assert.equal(
    await evaluate(`(() => {
      const shimmer = document.querySelector('[data-shimmer-content]')
      if (!shimmer) return false
      const style = getComputedStyle(shimmer)
      return style.backgroundClip.includes('text') &&
        style.backgroundImage.includes('linear-gradient') &&
        style.maskImage === 'none'
    })()`),
    true,
    'the live title should use one clipped-gradient text layer without a mask'
  )
  const backgroundPositions = []
  for (let index = 0; index < 30; index += 1) {
    const position = await evaluate(`(() => {
      const shimmer = document.querySelector('[data-shimmer-content]')
      return shimmer ? getComputedStyle(shimmer).backgroundPosition : null
    })()`)
    if (position === null) break
    backgroundPositions.push(position)
    await wait(20)
  }
  assert.ok(
    new Set(backgroundPositions).size >= 3,
    `the processing-row shimmer gradient should visibly move: ${JSON.stringify(backgroundPositions)}`
  )
  assert.equal(
    await evaluate(
      `Boolean(document.querySelector('[data-activity-group] [data-markdown]'))`
    ),
    false,
    'live processing text should not be duplicated as expanded markdown'
  )
  await waitFor(`Boolean(document.querySelector('[data-final-answer-replay]'))`, 'final replay')
  assert.equal(
    await evaluate(`(() => {
      const processing = document.querySelector('[data-activity-group]')
      return !processing || processing.getAttribute('data-state') === 'closed'
    })()`),
    true,
    'processing area should not remain expanded when final replay starts'
  )
  const lengths = []
  for (let index = 0; index < 80; index += 1) {
    const sample = await evaluate(`(() => {
      const replay = document.querySelector('[data-final-answer-replay]')
      return replay ? replay.textContent?.length ?? 0 : -1
    })()`)
    if (sample < 0 && lengths.some((length) => length > 0)) break
    lengths.push(Math.max(0, sample))
    if (lengths.at(-1) >= marker.length) break
    await wait(24)
  }

  assert.ok(
    new Set(lengths).size >= 3,
    `final answer should reveal across multiple frames: ${JSON.stringify(lengths)}`
  )
  assert.ok(
    lengths.every((length, index) => index === 0 || length >= lengths[index - 1]),
    `replayed final answer length must grow monotonically: ${JSON.stringify(lengths)}`
  )
  await waitFor(
    `[...document.querySelectorAll('.is-assistant')].some((node) =>
      node.textContent?.includes(${JSON.stringify(marker)})
    )`,
    'complete replay',
    5_000
  )
  console.log('assistant final answer replay CDP regression passed', { lengths })
} finally {
  await cdp.close()
}
