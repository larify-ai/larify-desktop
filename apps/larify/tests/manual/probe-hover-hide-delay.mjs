/* eslint-disable @typescript-eslint/explicit-function-return-type */
// 精确测量 hover 弹出延迟(HOVER_DELAY=200)与离开收起延迟(HIDE_DELAY=300)。
// 关键：先清场（鼠标移到角落并等待 HIDE_DELAY 过期），确保初始无 diff，再精确测量。
import { connectLarifyCdp } from './cdp-client.mjs'

const wait = (d) => new Promise((r) => setTimeout(r, d))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const send = (method, params = {}, timeout = 6000) =>
  Promise.race([
    cdp.send(method, params),
    new Promise((resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout ${method}`)), timeout)
    )
  ])

const openCard = `[...document.querySelectorAll('section[aria-label^="已编辑 "]')].find((c) => c.getClientRects().length)`
const rowExpr = `button:has(> span.min-w-0.flex-1.truncate.font-mono)`
const diffExpr = `document.querySelector('.larify-file-diff')`

const diffExists = () => evaluate(`Boolean(${diffExpr})`)

const moveTo = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

try {
  // 确保打开"卡片滑动变历史"会话（reload 后可能回到初始状态）
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button[data-session-id]')].find(x => x.textContent.trim() === '卡片滑动变历史')
    b?.click(); return Boolean(b)
  })()`)
  await wait(900)
  await evaluate(`(${openCard})?.scrollIntoView({ block: 'center' })`)
  await wait(400)

  // 1) 清场：把鼠标移到视口右下角(远离卡片)，等 HIDE_DELAY+余量，确保 diff 关闭
  const dims = await evaluate(`({ w: window.innerWidth, h: window.innerHeight })`)
  await moveTo(dims.w - 2, dims.h - 2)
  await wait(500)
  const initial = await diffExists()
  console.log('清场后 initial diffExists =', initial)

  // 2) 取一行中心坐标并用 elementFromPoint 校验命中
  const pt = await evaluate(`(() => {
    const card = ${openCard}
    if (!card) return null
    const row = card.querySelector(${JSON.stringify(rowExpr)})
    if (!row) return null
    const r = row.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const hit = document.elementFromPoint(cx, cy)
    return { cx, cy, hitInCard: card.contains(hit) }
  })()`)
  console.log('row point:', JSON.stringify(pt))

  // 3) hover 行，逐时刻采样 diff 是否出现 -> 测弹出延迟
  await moveTo(pt.cx, pt.cy)
  const t0 = Date.now()
  let openAt = null
  for (let i = 0; i < 40; i++) {
    if (await diffExists()) { openAt = Date.now() - t0; break }
    await wait(10)
  }
  console.log(`HOVER_DELAY 实测：diff 出现在 ${openAt}ms（期望 ~200ms 后）`)

  // 4) 鼠标移开(到角落)，测收起延迟
  await moveTo(dims.w - 2, dims.h - 2)
  const t1 = Date.now()
  let closeAt = null
  for (let i = 0; i < 60; i++) {
    if (!(await diffExists())) { closeAt = Date.now() - t1; break }
    await wait(10)
  }
  console.log(`HIDE_DELAY 实测：diff 收起于 ${closeAt}ms（期望 ~300ms 后）`)
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
