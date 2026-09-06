import { randomBytes } from 'node:crypto'
import { app } from 'electron'
import { join } from 'node:path'
import { shell } from 'electron'
import { clearEncryptedJson, readEncryptedJson, writeEncryptedJson } from '../secure-file'
import { createKeyedLock } from '../utils/lock'
import {
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens
} from '@ai-sdk/mcp'

const DEFAULT_PORT = Number(process.env.LARIFY_MCP_OAUTH_PORT ?? 8123)

export const mcpOAuthRedirectUrl = `http://127.0.0.1:${DEFAULT_PORT}/callback`

interface ServerState {
  clientInformation?: OAuthClientInformation
  tokens?: OAuthTokens
}

// One encrypted file per server, so servers never contend for a shared store and
// the read-modify-write merge logic disappears. A per-server lock keeps a single
// server's lazily-loaded read and its writes serialized.
const fileLock = createKeyedLock()
const filePath = (serverId: string): string =>
  join(app.getPath('userData'), 'mcp-oauth', `${encodeURIComponent(serverId)}.json`)

/**
 * OAuth client provider for one MCP server, adapted from the official AI SDK
 * `mcp-with-auth` example (`InMemoryOAuthClientProvider`).
 *
 * `@ai-sdk/mcp`'s `auth()` drives discovery, dynamic client registration, PKCE,
 * token exchange and refresh. This provider only adds the app-specific bits:
 * a stable loopback redirect URI, an in-memory PKCE verifier, the browser open,
 * and encrypted token persistence (per server) so a reconnect reuses credentials
 * instead of re-authorizing.
 *
 * Tokens/client info are lazily loaded into memory once; the MCP transport calls
 * `tokens()` on every request, so this avoids re-reading/decrypting the file each
 * time.
 *
 * The browser callback is NOT consumed here: `redirectToAuthorization` simply
 * opens the browser. The caller (connectMcp) runs a loopback server to capture
 * the auth code, then re-calls `auth()` with `authorizationCode` — mirroring the
 * official example's `authorizeWithPkceOnce`.
 */
export class McpOAuthClientProvider implements OAuthClientProvider {
  private codeVerifierValue?: string
  private pendingState?: string
  private clientInfo: OAuthClientInformation | undefined
  private accessTokens: OAuthTokens | undefined
  private loaded = false
  private readonly serverId: string

  constructor(args: { serverId: string }) {
    this.serverId = args.serverId
  }

  get redirectUrl(): string {
    return mcpOAuthRedirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `larify/${this.serverId}`,
      redirect_uris: [mcpOAuthRedirectUrl],
      application_type: 'native',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    await this.ensureLoaded()
    return this.accessTokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.accessTokens = tokens
    await this.persist()
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    await this.ensureLoaded()
    return this.clientInfo
  }

  async saveClientInformation(clientInformation: OAuthClientInformation): Promise<void> {
    this.clientInfo = clientInformation
    await this.persist()
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.codeVerifierValue = codeVerifier
  }

  async codeVerifier(): Promise<string> {
    if (!this.codeVerifierValue) throw new Error('MCP OAuth code verifier is unavailable.')
    return this.codeVerifierValue
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await shell.openExternal(authorizationUrl.href)
  }

  async state(): Promise<string> {
    this.pendingState = randomBytes(16).toString('base64url')
    return this.pendingState
  }

  async saveState(state: string): Promise<void> {
    this.pendingState = state
  }

  async storedState(): Promise<string | undefined> {
    return this.pendingState
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    if (scope === 'verifier') {
      this.codeVerifierValue = undefined
      return
    }
    if (scope === 'all' || scope === 'client') this.clientInfo = undefined
    if (scope === 'all' || scope === 'tokens') this.accessTokens = undefined
    await this.persist()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const state = await this.load()
    this.clientInfo = state.clientInformation
    this.accessTokens = state.tokens
  }

  private async load(): Promise<ServerState> {
    return fileLock(this.serverId, async () => {
      try {
        const state = (await readEncryptedJson(filePath(this.serverId))) as ServerState | null
        return state ?? {}
      } catch {
        // A corrupt/unreadable store must not permanently break the connection:
        // fall back to a fresh authorization, which overwrites the file on save.
        return {}
      }
    })
  }

  private async persist(): Promise<void> {
    await fileLock(this.serverId, async () => {
      const state: ServerState = {
        clientInformation: this.clientInfo,
        tokens: this.accessTokens
      }
      const path = filePath(this.serverId)
      if (state.clientInformation || state.tokens) {
        await writeEncryptedJson(path, state)
      } else {
        await clearEncryptedJson(path)
      }
    })
  }
}
