/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const cdp = await connectLarifyCdp()
const evaluate = (expression) => cdp.evaluate(expression)

try {
  const state = await evaluate(`({
    url: location.href,
    title: document.title,
    sessions: [...document.querySelectorAll('button[data-session-id]')].map((n) => ({
      text: n.textContent?.trim().slice(0, 60),
      current: n.getAttribute('aria-current') === 'page'
    })),
    cards: [...document.querySelectorAll('section[aria-label^="已编辑 "]')].map((n) => n.getAttribute('aria-label')),
    hasScrollViewport: Boolean(document.querySelector('[data-message-scroll-viewport]')),
    bodyText: document.body.textContent?.slice(0, 400)
  })`)
  console.log(JSON.stringify(state, null, 2))
} finally {
  cdp.close()
}
