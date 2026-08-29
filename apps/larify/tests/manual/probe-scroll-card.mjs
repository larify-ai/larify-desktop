/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)
const send = (method, params = {}, timeout = 6000) =>
  Promise.race([
    cdp.send(method, params),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${method}`)), timeout))
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
    const card = ${anyCardExpr}
    const diff = document.querySelector('.larify-file-diff')
    const diffScroll = diff?.querySelector('.max-h-72')
    const vp = document.querySelector('.larify-scrollbar-hidden.size-full')
    return {
      diffExists: Boolean(diff),
      diffOverscroll: diffScroll ? getComputedStyle(diffScroll).overscrollBehaviorY : null,
      diffScrollTop: diffScroll ? Math.round(diffScroll.scrollTop) : null,
      diffScrollable: diffScroll ? Math.round(diffScroll.scrollHeight - diffScroll.clientHeight) : null,
      viewportScrollTop: vp ? Math.round(vp.scrollTop) : null,
      viewportScrollable: vp ? Math.round(vp.scrollHeight - vp.clientHeight) : null
    }
  })()`)

try {
  // 打开会话并定位卡片
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button[data-session-id]')].find((x) => x.textContent?.trim() === '界面折叠问题咨询')
    b?.click(); return Boolean(b)
  })()`)
  await wait(900)
  await evaluate(`(${anyCardExpr})?.scrollIntoView({ block: 'center' })`)
  await wait(500)

  // 悬停首行 -> diff
  await moveCursorTo(rowExpr)
  await wait(500)
  console.log('hover:', JSON.stringify(await snap()))

  const cpt = await moveCursorTo('.larify-file-diff .max-h-72')
  await wait(200)

  // 把对话历史滚离底部（向上滚 diff 顶附近）
  for (let i = 0; i < 2; i++) {
    await moveCursorTo('.larify-file-diff .max-h-72')
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cpt.x, y: cpt.y, deltaY: -120, deltaX: 0 }, 8000)
    await wait(120)
  }
  console.log('after up (history away from bottom):', JSON.stringify(await snap()))

  // diff 内容滚到底
  for (let i = 0; i < 14; i++) {
    await moveCursorTo('.larify-file-diff .max-h-72')
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cpt.x, y: cpt.y, deltaY: 120, deltaX: 0 }, 8000)
    await wait(120)
  }
  console.log('diff at bottom:', JSON.stringify(await snap()))

  // extra DOWN beyond bottom: expect history NOT to move
  await moveCursorTo('.larify-file-diff .max-h-72')
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cpt.x, y: cpt.y, deltaY: 120, deltaX: 0 }, 8000)
  await wait(400)
  console.log('extra DOWN (expect history static):', JSON.stringify(await snap()))
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
