/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { connectLarifyCdp } from './cdp-client.mjs'

const promptPath = process.argv[2]
if (!promptPath) throw new Error('Usage: node tests/manual/run-prompt.cdp.mjs <prompt.md>')
const promptFile = resolve(promptPath)
const source = await readFile(promptFile, 'utf8')
const prompt = source.includes('## PROMPT') ? source.split('## PROMPT', 2)[1].trim() : source.trim()
const { close, evaluate, send } = await connectLarifyCdp()
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
const waitFor = async (expression, label, timeout = 300_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await wait(250)
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  await send('Page.bringToFront')
  await waitFor(
    `(() => {
      const button = document.querySelector('.lucide-message-circle-plus')?.closest('button')
      button?.click()
      return Boolean(button)
    })()`,
    'new task button',
    10_000
  )
  await waitFor(
    `(() => {
      const textarea = [...document.querySelectorAll('form textarea')]
        .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
      return Boolean(textarea && !textarea.disabled && textarea.getBoundingClientRect().width > 0)
    })()`,
    'visible assistant composer',
    10_000
  )
  const inserted = await evaluate(`(() => {
    const textarea = [...document.querySelectorAll('form textarea')]
      .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
    if (!(textarea instanceof HTMLTextAreaElement)) return null
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      textarea,
      ${JSON.stringify(prompt)}
    )
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    return textarea.value
  })()`)
  if (inserted !== prompt) throw new Error('Prompt was not inserted completely')
  const submitted = await evaluate(`(() => {
    const textarea = [...document.querySelectorAll('form textarea')]
      .find((candidate) => !candidate.classList.contains('xterm-helper-textarea'))
    const form = textarea?.closest('form')
    form?.requestSubmit()
    return Boolean(form)
  })()`)
  if (!submitted) throw new Error('Prompt was not submitted')

  await waitFor(
    `Boolean(document.querySelector('button[aria-label="停止"]'))`,
    'agent run to start',
    30_000
  )
  await waitFor(`!document.querySelector('button[aria-label="停止"]')`, 'agent run to finish')

  const promptMarker = prompt.slice(0, 120)
  const sessionId = await waitFor(
    `(async () => {
      const sessions = await window.bridge.invoke('session:list', '', 0, 20)
      for (const session of sessions) {
        const messages = await window.bridge.invoke('session:msgs', session.id)
        if (messages.some(({ parts = [] }) => parts.some(({ text }) =>
          typeof text === 'string' && text.includes(${JSON.stringify(promptMarker)})
        ))) return session.id
      }
      return null
    })()`,
    'persisted agent session',
    30_000
  )
  const messages = await waitFor(
    `(async () => {
      const messages = await window.bridge.invoke('session:msgs', ${JSON.stringify(sessionId)})
      return messages.some(({ role, parts = [] }) =>
        role === 'assistant' && parts.some(({ type, state }) => type === 'text' && state === 'done')
      ) ? messages : null
    })()`,
    'persisted agent completion'
  )
  console.log(JSON.stringify({ promptFile, sessionId, messages }, null, 2))
} finally {
  close()
}
