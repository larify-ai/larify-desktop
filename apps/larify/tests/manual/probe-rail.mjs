import { connectLarifyCdp } from './cdp-client.mjs'
const cdp = await connectLarifyCdp()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await cdp.evaluate(`(() => { const b=document.querySelector('button[data-session-id="02a5241f-5b2f-4ea5-9515-0a6f8e49f535"]'); if(b)b.click(); return true })()`)
await wait(1500)
const info = await cdp.evaluate(`(() => {
  const rail = document.querySelector('[aria-label="对话快速导航"]')
  const markers = rail ? rail.querySelectorAll('[data-navigation-entry]').length : -1
  return {
    railMarkers: markers,
    renderedMessages: document.querySelectorAll('[data-message-index]').length,
    domNodes: document.querySelectorAll('*').length,
    viteScripts: document.querySelectorAll('script[src*="/@vite/"], script[src*="@vite"]').length,
    devRuntime: !!window.__vite_plugin_react_preamble_installed__ || !!document.querySelector('script[src*="react_jsx-dev-runtime"]')
  }
})()`)
console.log(JSON.stringify(info, null, 2))
cdp.close()
