/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const cardSelector = 'section[aria-label^="已编辑 "]'
const cardExpression = `[...document.querySelectorAll(${JSON.stringify(cardSelector)})].find((candidate) => candidate.getClientRects().length)`
const rowSelector = 'button:has(> span.min-w-0.flex-1.truncate.font-mono)'
const waitFor = async (expression, label, timeout = 5_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(50)
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  const switched = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button[data-session-id]')].find((candidate) =>
      candidate.textContent?.includes(${JSON.stringify(process.env.LARIFY_REVIEW_CARD_SESSION ?? '请使用工具分两步完成')})
    )
    button?.click()
    return Boolean(button)
  })()`)
  if (switched) await wait(300)
  await evaluate(`(${cardExpression})?.scrollIntoView({ block: 'center' })`)
  await wait(300)

  if (!(await evaluate(`Boolean(${cardExpression})`))) {
    const sessionCount = await evaluate(`document.querySelectorAll('button[data-session-id]').length`)
    for (let index = 0; index < sessionCount; index += 1) {
      await evaluate(`document.querySelectorAll('button[data-session-id]')[${index}]?.click()`)
      await wait(150)
      await evaluate(`(${cardExpression})?.scrollIntoView({ block: 'center' })`)
      await wait(150)
      if (await evaluate(`Boolean(${cardExpression})`)) break
    }
  }

  const diagnostics = await evaluate(`({
    cards: [...document.querySelectorAll('section[aria-label]')].map((node) => node.getAttribute('aria-label')),
    selectedSession: [...document.querySelectorAll('button[data-session-id]')]
      .find((node) => node.getAttribute('aria-current') === 'page')?.textContent?.trim(),
    visibleMessages: [...document.querySelectorAll('[data-message-index]')]
      .slice(-3).map((node) => node.textContent?.slice(0, 80))
  })`)
  console.log(JSON.stringify({ diagnostics }, null, 2))

  const card = await waitFor(
    `(${cardExpression})?.getAttribute('aria-label')`,
    'changes summary card'
  )
  const rows = await evaluate(
    `(${cardExpression})?.querySelectorAll(${JSON.stringify(rowSelector)}).length`
  )
  if (!rows) throw new Error(`Unexpected card row count: ${rows}`)

  const point = await evaluate(`(() => {
    const row = (${cardExpression})?.querySelectorAll(${JSON.stringify(rowSelector)})[0]
    row?.scrollIntoView({ block: 'center' })
    const rect = row?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  })()`)
  if (!point) throw new Error('First file row has no bounds')
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y
  })
  const hoverPath = await waitFor(
    `Boolean((${cardExpression})?.parentElement?.querySelector('.larify-file-diff'))`,
    'hover diff preview'
  )
  const placement = await evaluate(`(() => {
    const card = (${cardExpression})
    const preview = card?.parentElement?.querySelector('.larify-file-diff')?.parentElement
    const viewport = card?.closest('[data-message-scroll-viewport]')
    if (!card || !preview || !viewport) return null
    const previewRect = preview.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    return {
      below: preview.classList.contains('top-full'),
      previewBottom: previewRect.bottom,
      previewTop: previewRect.top,
      viewportBottom: viewportRect.bottom,
      viewportTop: viewportRect.top
    }
  })()`)
  if (!placement) throw new Error('Unable to measure hover diff placement')
  if (placement.previewTop < placement.viewportTop - 1 || placement.previewBottom > placement.viewportBottom + 1) {
    throw new Error(`Hover diff is clipped: ${JSON.stringify(placement)}`)
  }

  await evaluate(
    `(${cardExpression})?.querySelectorAll(${JSON.stringify(rowSelector)})[0]?.click()`
  )
  const reviewView =
    '[data-workbench-session][data-active] [data-workbench-view="changes"][data-active]'
  await waitFor(`Boolean(document.querySelector('${reviewView}'))`, 'all changes view')

  console.log(
    JSON.stringify({ card, hoverPath: Boolean(hoverPath), placement, rows }, null, 2)
  )
} finally {
  cdp.close()
}
