/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const send = (method, params = {}, timeout = 6000) =>
  Promise.race([
    cdp.send(method, params),
    new Promise((resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout ${method}`)), timeout)
    )
  ])

const anyCardExpr = `[...document.querySelectorAll('section[aria-label^="已编辑 "]')].find((c) => c.getClientRects().length)`
const rowExpr = `button:has(> span.min-w-0.flex-1.truncate.font-mono)`

const moveCursorTo = async (selector) => {
  const pt = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!pt) return null
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
  return pt
}

const snap = () =>
  evaluate(`(() => {
    const diff = document.querySelector('.larify-file-diff')
    return { diffExists: Boolean(diff), diffText: diff?.querySelector('.truncate')?.textContent ?? null }
  })()`)

try {
  // 确保在某会话（若无可视卡片，尝试打开一个有卡片的会话）
  const hasCard = await evaluate(`Boolean(${anyCardExpr})`)
  if (!hasCard) {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button[data-session-id]')].find((x) => x.textContent?.trim() === '界面折叠问题咨询')
      b?.click(); return Boolean(b)
    })()`)
    await wait(900)
  }
  await evaluate(`(${anyCardExpr})?.scrollIntoView({ block: 'center' })`)
  await wait(400)

  // 快速掠过：hover 行后立即测量（不等待）
  const pt = await moveCursorTo(rowExpr)
  await wait(20)
  console.log('T~20ms (expect no diff):', JSON.stringify(await snap()))

  // 停留 120ms（仍在 200ms HOVER_DELAY 内）
  await wait(115)
  console.log('T~135ms (expect no diff):', JSON.stringify(await snap()))

  // 再停留到超过 200ms（应弹出；若仍是 300ms 则不应弹）
  await wait(90)
  console.log('T~225ms (expect diff shown @200ms):', JSON.stringify(await snap()))

  // 停留更久确认仍在
  await wait(60)
  console.log('T~285ms (expect diff shown):', JSON.stringify(await snap()))
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
