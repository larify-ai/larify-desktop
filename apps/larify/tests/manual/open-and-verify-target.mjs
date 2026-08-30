/* 打开目标会话并验证消息区显示的是目标会话内容（分步，稳健） */
import { connectLarifyCdp } from './cdp-client.mjs'
const SESSION_ID = '02a5241f-5b2f-4ea5-9515-0a6f8e49f535'
let cdp = await connectLarifyCdp()
const evaluate = (e) => cdp.evaluate(e)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (expr, label, timeout = 90000) => {
  const s = Date.now()
  while (Date.now() - s < timeout) { const v = await evaluate(expr); if (v) return v; await wait(100) }
  throw new Error('timeout ' + label)
}
const safe = async (label, fn) => { try { const r = await fn(); console.log('OK', label, JSON.stringify(r)); return r } catch (e) { console.log('FAIL', label, e.message) } }

try {
  await cdp.send('Page.enable')
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait(600)
  cdp.close(); cdp = await connectLarifyCdp()
  await waitFor(`document.querySelectorAll('[data-session-id]').length > 0`, 'sidebar', 60000)
  for (let k = 0; k < 3; k++) {
    await evaluate(`([...document.querySelectorAll('button')].filter(b => (b.textContent||'').trim().startsWith('更多')).forEach(b=>b.click()))`)
    await wait(700)
  }
  await waitFor(`Boolean(document.querySelector('button[data-session-id="' + '${SESSION_ID}' + '"]'))`, 'target', 30000)
  await safe('before-selected', () => evaluate(`(() => { const s = document.querySelector('[data-session-id][data-state="active"]'); return s ? s.getAttribute('data-session-id') : null })()`))
  await evaluate(`document.querySelector('button[data-session-id="' + '${SESSION_ID}' + '"]').click()`)
  await waitFor(`document.querySelectorAll('[data-message-index]').length > 0`, 'messages', 60000)
  await wait(2000)

  await safe('msgCount', () => evaluate(`document.querySelectorAll('[data-message-index]').length`))
  await safe('lastMsgs', () => evaluate(`JSON.stringify([...document.querySelectorAll('[data-message-index]')].slice(-5).map(m => (m.textContent||'').trim().slice(0,50)))`))
  await safe('firstMsgs', () => evaluate(`JSON.stringify([...document.querySelectorAll('[data-message-index]')].slice(0,4).map(m => (m.textContent||'').trim().slice(0,50)))`))
  await safe('targetTitle', () => evaluate(`document.body.innerText.includes('代码审查与优化建议')`))
  await safe('groupCount', () => evaluate(`document.querySelectorAll('[data-activity-group]').length`))
  await safe('activityGroupStates', () => evaluate(`JSON.stringify([...document.querySelectorAll('[data-activity-group]')].map(g => g.getAttribute('data-state')).slice(0,20))`))
} catch (e) { console.error('ERR', e.message) } finally { cdp.close() }
