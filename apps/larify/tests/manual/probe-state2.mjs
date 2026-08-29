/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const cdp = await connectLarifyCdp()
try {
  const r = await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('section[aria-label^="已编辑 "]')].find((c) => c.getClientRects().length)
    const sessionBtn = document.querySelector('button[data-session-id]')
    return {
      hasCard: Boolean(card),
      sessionName: sessionBtn?.textContent?.trim()?.slice(0, 30),
      viewportScroll: document.querySelector('[data-message-scroll-viewport]')?.scrollTop ?? null
    }
  })()`)
  console.log(JSON.stringify(r))
} catch (err) {
  console.error('ERROR:', err.message)
} finally {
  cdp.close()
}
