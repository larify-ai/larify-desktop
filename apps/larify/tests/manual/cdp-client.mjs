/* eslint-disable @typescript-eslint/explicit-function-return-type */
import WebSocket from 'ws'

export async function connectLarifyCdp(port = process.env.LARIFY_CDP_PORT ?? '9222') {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
    response.json()
  )
  const target = targets.find(
    ({ type, url }) => type === 'page' && url.startsWith('http://localhost:')
  )
  if (!target?.webSocketDebuggerUrl) throw new Error(`Larify page not found on port ${port}`)

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  let nextId = 0
  const pending = new Map()
  const eventListeners = new Set()
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    const command = pending.get(message.id)
    if (!command) {
      for (const listener of eventListeners) listener(message)
      return
    }
    pending.delete(message.id)
    if (message.error) command.reject(new Error(message.error.message))
    else command.resolve(message.result)
  })
  socket.on('close', () => {
    for (const command of pending.values()) command.reject(new Error('CDP connection closed'))
    pending.clear()
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      )
    }
    return result.result.value
  }

  return {
    close: () => socket.close(),
    evaluate,
    onEvent(listener) {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    send
  }
}
