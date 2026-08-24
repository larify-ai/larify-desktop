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
  await waitFor(`document.querySelectorAll('button[data-session-id]').length > 0`, 'session list')

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
    const sessionCount = await evaluate(
      `document.querySelectorAll('button[data-session-id]').length`
    )
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
    row?.focus()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  })()`)
  if (!point) throw new Error('First file row has no bounds')
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 0,
    y: 0
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y
  })
  await evaluate(
    `(${cardExpression})?.querySelectorAll(${JSON.stringify(rowSelector)})[0]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`
  )
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
  if (
    placement.previewTop < placement.viewportTop - 1 ||
    placement.previewBottom > placement.viewportBottom + 1
  ) {
    throw new Error(`Hover diff is clipped: ${JSON.stringify(placement)}`)
  }

  await evaluate(`(() => {
    const session = document.querySelector('[data-workbench-session][data-active]')
    window.__larifyReviewOpenTexts = []
    window.__larifyReviewOpenObserver = new MutationObserver(() => {
      window.__larifyReviewOpenTexts.push(session?.textContent ?? '')
    })
    if (session) {
      window.__larifyReviewOpenObserver.observe(session, {
        characterData: true,
        childList: true,
        subtree: true
      })
    }
    (${cardExpression})?.querySelectorAll(${JSON.stringify(rowSelector)})[0]?.click()
  })()`)
  const reviewView =
    '[data-workbench-session][data-active] [data-workbench-view="changes"][data-active]'
  await waitFor(`Boolean(document.querySelector('${reviewView}'))`, 'all changes view')
  const openResult = await evaluate(`(() => {
    window.__larifyReviewOpenObserver?.disconnect()
    const texts = window.__larifyReviewOpenTexts ?? []
    delete window.__larifyReviewOpenObserver
    delete window.__larifyReviewOpenTexts
    const activeTab = document.querySelector(
      '[data-workbench-session][data-active] .larify-workbench-tab-trigger[data-state="active"]'
    )
    return {
      activeTabHasChangesIcon: Boolean(activeTab?.querySelector('.larify-workbench-icon-changes')),
      showedOpenFilePrompt: texts.some((text) => text.includes('打开文件'))
    }
  })()`)
  if (openResult.showedOpenFilePrompt) {
    throw new Error('Opening a review card briefly showed the file-workbench prompt')
  }
  if (!openResult.activeTabHasChangesIcon) {
    throw new Error('The opened review tab does not use the Changes icon')
  }

  console.log(
    JSON.stringify({ card, hoverPath: Boolean(hoverPath), openResult, placement, rows }, null, 2)
  )
} finally {
  cdp.close()
}
