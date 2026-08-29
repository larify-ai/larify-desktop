/* eslint-disable @typescript-eslint/explicit-function-return-type */
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

try {
  // 点击会话侧栏，遍历 session 按钮
  const sessions = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[data-session-id]')]
    return btns.map((b) => ({ name: b.textContent.trim().slice(0, 30), id: b.getAttribute('data-session-id') }))
  })()`)
  console.log('session count:', sessions.length)

  const results = []
  for (const s of sessions) {
    await evaluate(`(() => { const b = [...document.querySelectorAll('button[data-session-id]')].find(x => x.getAttribute('data-session-id') === ${JSON.stringify(s.id)}); b?.click(); return true })()`)
    await wait(700)
    const info = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('section[aria-label^="已编辑 "]')].filter(c => c.getClientRects().length)
      const counts = cards.map(c => c.getAttribute('aria-label'))
      return { cards: counts }
    })()`)
    results.push({ name: s.name, cards: info.cards })
    console.log('session:', s.name, JSON.stringify(info.cards))
  }
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
