/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { connectLarifyCdp } from './cdp-client.mjs'

const marker = process.argv[2]
if (!marker) throw new Error('Usage: node tests/manual/inspect-prompt-run.cdp.mjs <marker>')

const { close, evaluate } = await connectLarifyCdp()
try {
  const result = await evaluate(`(async () => {
    const sessions = await window.bridge.invoke('session:list', '', 0, 30)
    for (const session of sessions) {
      const messages = await window.bridge.invoke('session:msgs', session.id)
      if (!messages.some(({ parts = [] }) => parts.some(({ text }) =>
        typeof text === 'string' && text.includes(${JSON.stringify(marker)})
      ))) continue
      return {
        session,
        messages: messages.map(({ role, parts = [] }) => ({
          role,
          parts: parts.map((part) => ({
            type: part.type,
            state: part.state,
            toolName: part.toolName,
            errorText: part.errorText,
            text: part.text?.slice(0, 2000),
            input: part.input,
            output: typeof part.output === 'string' ? part.output.slice(0, 1000) : part.output
          }))
        }))
      }
    }
    return null
  })()`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  close()
}
