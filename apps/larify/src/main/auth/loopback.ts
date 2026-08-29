import { createServer } from 'node:http'

const CALLBACK_PATH = '/callback'
const TIMEOUT_MS = 5 * 60 * 1000

export interface LoopbackCallback {
  redirectUri: string
  result: Promise<URL>
  close: () => void
}

export async function openLoopbackCallback(): Promise<LoopbackCallback> {
  let origin = 'http://127.0.0.1'
  let settle: ((url: URL) => void) | undefined
  let reject: ((error: Error) => void) | undefined
  const result = new Promise<URL>((resolve, rejectResult) => {
    settle = resolve
    reject = rejectResult
  })

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', origin)
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><script>window.close()</script></body></html>')
    settle?.(url)
    server.close()
  })

  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Unable to start the login callback server.')
  }
  origin = `http://127.0.0.1:${address.port}`

  const timeout = setTimeout(() => {
    reject?.(new Error('Login timed out.'))
    server.close()
  }, TIMEOUT_MS)
  timeout.unref()
  void result.finally(() => clearTimeout(timeout))

  return {
    redirectUri: `${origin}${CALLBACK_PATH}`,
    result,
    close: () => server.close()
  }
}
