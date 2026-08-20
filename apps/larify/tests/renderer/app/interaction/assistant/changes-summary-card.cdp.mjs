/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from '../../../../manual/cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const cardSelector = 'section[aria-label="已编辑 2 个文件"]'
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
  if (!switched) throw new Error('Review-card session not found')
  await wait(300)

  const card = await waitFor(
    `(${cardExpression})?.getAttribute('aria-label')`,
    'changes summary card'
  )
  const rows = await evaluate(
    `(${cardExpression})?.querySelectorAll(${JSON.stringify(rowSelector)}).length`
  )
  if (rows !== 2) throw new Error(`Unexpected card row count: ${rows}`)

  const point = await evaluate(`(() => {
    const row = (${cardExpression})?.querySelectorAll(${JSON.stringify(rowSelector)})[0]
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
    `(${cardExpression})?.parentElement?.querySelector('.larify-file-diff')?.textContent?.includes('live-review-a.txt')`,
    'hover diff preview'
  )

  await evaluate(
    `(${cardExpression})?.querySelectorAll(${JSON.stringify(rowSelector)})[0]?.click()`
  )
  const reviewView =
    '[data-workbench-session][data-active] [data-workbench-view="changes"][data-active]'
  await waitFor(`Boolean(document.querySelector('${reviewView}'))`, 'all changes view')
  const changes = await waitFor(
    `(() => {
      const view = document.querySelector('${reviewView}')
      const tree = view?.querySelector('.workspace-tree-scroll')
      const preview = view?.querySelector('.workspace-file-preview')
      const root = tree?.querySelector('.rc-tree-treenode[aria-expanded] .rc-tree-title')?.textContent?.trim()
      const selected = tree?.querySelector('.rc-tree-node-selected .rc-tree-title')?.textContent?.trim()
      return preview && root && selected ? { root, selected } : null
    })()`,
    'selected current change'
  )
  if (changes.root === '.') throw new Error('Changes tree root is still a dot')

  console.log(JSON.stringify({ card, changes, hoverPath: Boolean(hoverPath), rows }, null, 2))
} finally {
  cdp.close()
}
