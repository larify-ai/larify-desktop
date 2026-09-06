import { createServer } from 'node:http'
import { mcpOAuthRedirectUrl } from './mcp-oauth-provider'

const CALLBACK_PATH = '/callback'
const TIMEOUT_MS = 5 * 60 * 1000

/**
 * Loopback callback server for MCP OAuth, mirroring the official AI SDK
 * `mcp-with-auth` example's `waitForAuthorizationCode`.
 *
 * It binds the SAME fixed port used by the provider's redirect URI so the
 * authorization server's callback resolves here. Returns the `code` (and
 * `state`) from the callback query, or rejects on a provider error/timeout.
 *
 * Callers open the listener AFTER `auth()` signals the browser flow; the browser
 * redirect always arrives after the user interacts, so the listener is ready.
 */
export interface McpAuthCode {
  code: string
  state?: string
  /** RFC 9207 issuer value from the authorization response, for mix-up protection. */
  iss?: string
}

/**
 * @param redirectUrl - Loopback URL to listen on; defaults to the provider's
 * shared redirect URI. Pass a custom value in tests to avoid port conflicts.
 */
export function waitForMcpAuthorizationCode(
  redirectUrl: string = mcpOAuthRedirectUrl
): Promise<McpAuthCode> {
  const url = new URL(redirectUrl)

  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', url.origin)
      if (requestUrl.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end('Not found')
        return
      }
      const code = requestUrl.searchParams.get('code')
      const err = requestUrl.searchParams.get('error')
      if (code) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>授权成功</h1><p>请关闭此窗口。</p></body></html>'
        )
        setTimeout(() => server.close(), 100)
        resolve({
          code,
          ...(requestUrl.searchParams.get('state')
            ? { state: requestUrl.searchParams.get('state') ?? undefined }
            : {}),
          ...(requestUrl.searchParams.get('iss')
            ? { iss: requestUrl.searchParams.get('iss') ?? undefined }
            : {})
        })
      } else {
        response.writeHead(400).end(`Authorization failed: ${err ?? 'missing code'}`)
        setTimeout(() => server.close(), 100)
        reject(new Error(`Authorization failed: ${err ?? 'missing code'}`))
      }
    })

    server.once('error', reject)
    server.listen(Number(url.port), '127.0.0.1', () => {
      console.log(`[mcp-oauth] Callback: ${mcpOAuthRedirectUrl}`)
    })

    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('MCP OAuth callback timed out.'))
    }, TIMEOUT_MS)
    timeout.unref()
  })
}
