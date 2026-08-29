/* eslint-disable @typescript-eslint/explicit-function-return-type */
// 坐标校验版：用 elementFromPoint 确认 wheel 坐标命中列表行，消除 probe-overscroll2 的坐标污染疑点。
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

const state = () =>
  evaluate(`(() => {
    const list = document.querySelector('[data-message-local-scroll]')
    const viewport = document.querySelector('[data-message-scroll-viewport]')
    return { listTop: list?.scrollTop ?? null, viewportTop: viewport?.scrollTop ?? null }
  })()`)

const wheel = async (x, y, dY) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dY })
}

try {
  // 打开会话
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button[data-session-id]')].find(x => x.textContent.trim() === '卡片滑动变历史')
    b?.click(); return Boolean(b)
  })()`)
  await wait(900)
  await evaluate(`document.querySelector('section[aria-label^="已编辑 "]')?.scrollIntoView({ block: 'center' })`)
  await wait(400)

  // 计算列表行中心坐标 + 用 elementFromPoint 校验命中目标
  const pt = await evaluate(`(() => {
    const section = document.querySelector('section[aria-label^="已编辑 "]')
    const list = document.querySelector('[data-message-local-scroll]')
    if (!section || !list) return null
    const rowBtn = [...section.querySelectorAll('button')].find((b) => b.querySelector('span.min-w-0.truncate'))
    if (!rowBtn) return null
    const r = rowBtn.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const hit = document.elementFromPoint(cx, cy)
    const inList = list.contains(hit)
    return {
      cx, cy,
      hitInList: inList,
      hitText: hit?.closest('button')?.textContent?.trim()?.slice(0, 25) ?? null,
      hitTag: hit?.tagName ?? null,
      listScrollable: list.scrollHeight - list.clientHeight
    }
  })()`)
  console.log('row point:', JSON.stringify(pt))
  if (!pt || !pt.hitInList) {
    console.log('WARN: 坐标未命中列表行，probe-overscroll2 的 listDelta=0 疑为坐标污染')
  } else {
    console.log('OK: 坐标命中列表行（elementFromPoint 校验通过）')
  }

  // 鼠标移到命中点
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.cx, y: pt.cy })
  await wait(50)

  // 列表滚回顶
  await evaluate(`(document.querySelector('[data-message-local-scroll]') && (document.querySelector('[data-message-local-scroll]').scrollTop = 0))`)
  await wait(50)

  const init = await state()
  console.log('init listTop=', init.listTop, 'viewportTop=', init.viewportTop, '| scrollable=', pt.listScrollable)

  // 在命中坐标上单次向下 wheel 60px
  await wheel(pt.cx, pt.cy, 60)
  await wait(50)
  const a = await state()
  const listDelta = a.listTop - init.listTop
  const viewportDelta = Math.round((a.viewportTop - init.viewportTop) * 10) / 10
  console.log(`wheel@命中点 60px: listDelta=${listDelta} viewportDelta=${viewportDelta}`)

  // 列表已到底(scrollTop=28)，再向下 wheel 60px，确认不传导到对话历史
  await evaluate(`document.querySelector('[data-message-local-scroll]').scrollTop = 28`)
  await wait(50)
  const b0 = await state()
  await wheel(pt.cx, pt.cy, 60)
  await wait(50)
  const b = await state()
  const bViewportDelta = Math.round((b.viewportTop - b0.viewportTop) * 10) / 10
  console.log(`bottom wheel@命中点 60px: listTop=${b.listTop} viewportDelta=${bViewportDelta} => 传导=${bViewportDelta !== 0}`)

  // 列表到顶(scrollTop=0)，向上 wheel -60px，确认不传导到对话历史
  await evaluate(`document.querySelector('[data-message-local-scroll]').scrollTop = 0`)
  await wait(50)
  const c0 = await state()
  await wheel(pt.cx, pt.cy, -60)
  await wait(50)
  const c = await state()
  const cViewportDelta = Math.round((c.viewportTop - c0.viewportTop) * 10) / 10
  console.log(`top wheel@命中点 -60px: listTop=${c.listTop} viewportDelta=${cViewportDelta} => 传导=${cViewportDelta !== 0}`)
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
