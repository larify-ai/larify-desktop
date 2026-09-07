import { net, shell } from 'electron'
import * as oidc from 'openid-client'

import type { AuthState, AuthUser } from '@shared/auth'
import { clearCredentials, loadCredentials, saveCredentials } from './credential-store'
import { openLoopbackCallback } from './loopback'

const ISSUER = new URL(process.env.LARIFY_AUTH_ISSUER ?? 'https://larify.ai/api/auth')
const CLIENT_ID = process.env.LARIFY_AUTH_CLIENT_ID ?? 'larify-desktop'
const SCOPES = 'openid email offline_access'

let authService: AuthService | undefined

export function getAuthService(): AuthService {
  authService ??= new AuthService()
  return authService
}

export class AuthService {
  private state: AuthState = { status: 'restoring' }
  private config?: oidc.Configuration
  private refreshToken?: string
  private accessToken?: string
  private accessTokenExpiresAt = 0
  private refreshAttempt?: Promise<string | null>
  private listeners = new Set<(state: AuthState) => void>()
  private loginAttempt?: Promise<AuthState>

  getState(): AuthState {
    return this.state
  }

  /**
   * Returns a valid OIDC access token, refreshing it when expired or absent.
   * Used by the New API integration to authenticate against larify.ai.
   */
  async getAccessToken(): Promise<string | null> {
    if (this.state.status !== 'authenticated') return null
    if (this.accessToken && this.accessTokenExpiresAt > Date.now() + 60_000) {
      return this.accessToken
    }
    if (!this.refreshToken) return null
    // Single-flight: concurrent callers share one refresh so a rotated refresh
    // token is never handed to the issuer twice (the loser would get rejected
    // by the reuse policy and misreport a sign-out).
    this.refreshAttempt ??= this.performRefresh()
    try {
      return await this.refreshAttempt
    } finally {
      this.refreshAttempt = undefined
    }
  }

  private async performRefresh(): Promise<string | null> {
    const refreshToken = this.refreshToken
    if (!refreshToken) return null
    try {
      const tokens = await oidc.refreshTokenGrant(await this.getConfig(), refreshToken)
      // 服务端每次刷新都会轮换刷新令牌（旧令牌立即作废）。必须【先落盘】新 refresh token
      // 到 auth.json，再更新内存，确保进程退出时文件里始终是最新令牌、绝不留已作废的旧令牌；
      // 否则重启 restore 用旧令牌刷新会被服务端判为"已撤销"并触发 invalidateRefreshFamily
      // 全量清空，导致"重启后需重新登录"。getAccessToken 已保证此处为 authenticated，
      // 故 user 必然存在（仅用类型守卫取得），不把持久化绑定在可变状态上。
      // 关键：即使 persist 失败（磁盘/锁异常），也必须无条件 adoptTokens 更新内存为新令牌，
      // 否则内存停留旧令牌，下次刷新继续用旧令牌会触发服务端家族撤销（正是本 bug 的根因）。
      const user = this.state.status === 'authenticated' ? this.state.user : undefined
      if (tokens.refresh_token && user) {
        try {
          await this.persist(tokens.refresh_token, user)
        } catch {
          // persist 失败不阻断：下方 adoptTokens 仍会把内存更新为新令牌，避免复用旧令牌。
        }
      }
      this.adoptTokens(tokens)
      return this.accessToken ?? null
    } catch {
      return null
    }
  }

  private adoptTokens(tokens: Awaited<ReturnType<typeof oidc.refreshTokenGrant>>): void {
    this.accessToken = tokens.access_token ?? undefined
    this.accessTokenExpiresAt =
      typeof tokens.expires_in === 'number'
        ? Date.now() + tokens.expires_in * 1000
        : 0
    if (tokens.refresh_token) this.refreshToken = tokens.refresh_token
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async restore(): Promise<void> {
    try {
      const stored = await loadCredentials()
      if (!stored) {
        this.setState({ status: 'unauthenticated' })
        return
      }
      const tokens = await oidc.refreshTokenGrant(await this.getConfig(), stored.refreshToken)
      const user = await this.loadUser(tokens.access_token, stored.user.id)
      await this.persist(tokens.refresh_token ?? stored.refreshToken, user)
      this.adoptTokens(tokens)
      this.setState({ status: 'authenticated', user })
    } catch (error) {
      if (isInvalidGrant(error)) {
        this.refreshToken = undefined
        this.accessToken = undefined
        try {
          await clearCredentials()
        } catch {
          // The expired session must not leave the app stuck in the restoring state.
        }
      }
      this.setState({ status: 'unauthenticated', error: messageFor(error) })
    }
  }

  login(): Promise<AuthState> {
    if (!this.loginAttempt) {
      this.loginAttempt = this.performLogin().finally(() => {
        this.loginAttempt = undefined
      })
    }
    return this.loginAttempt
  }

  async logout(): Promise<void> {
    const refreshToken = this.refreshToken
    await clearCredentials()
    this.refreshToken = undefined
    this.accessToken = undefined
    this.setState({ status: 'unauthenticated' })
    if (refreshToken) {
      try {
        await oidc.tokenRevocation(await this.getConfig(), refreshToken, {
          token_type_hint: 'refresh_token'
        })
      } catch {
        // Local logout must still succeed when the authorization server is unavailable.
      }
    }
  }

  private async performLogin(): Promise<AuthState> {
    let callback: Awaited<ReturnType<typeof openLoopbackCallback>> | undefined
    try {
      callback = await openLoopbackCallback()
      const config = await this.getConfig()
      const codeVerifier = oidc.randomPKCECodeVerifier()
      const state = oidc.randomState()
      const nonce = oidc.randomNonce()
      const authorizationUrl = oidc.buildAuthorizationUrl(config, {
        redirect_uri: callback.redirectUri,
        scope: SCOPES,
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
        prompt: 'login',
      })
      await shell.openExternal(authorizationUrl.href)
      const responseUrl = await callback.result
      const tokens = await oidc.authorizationCodeGrant(config, responseUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce
      })
      if (!tokens.refresh_token) throw new Error('The login server did not return a refresh token.')
      const subject = tokens.claims()?.sub
      if (!subject) throw new Error('The login server did not return a user identity.')
      const user = await this.loadUser(tokens.access_token, subject)
      await this.persist(tokens.refresh_token, user)
      this.adoptTokens(tokens)
      const authenticated: AuthState = { status: 'authenticated', user }
      this.setState(authenticated)
      return authenticated
    } catch (error) {
      const state: AuthState = { status: 'unauthenticated', error: messageFor(error) }
      this.setState(state)
      return state
    } finally {
      callback?.close()
    }
  }

  private async loadUser(accessToken: string, subject: string): Promise<AuthUser> {
    const userInfo = await oidc.fetchUserInfo(await this.getConfig(), accessToken, subject)
    if (typeof userInfo.email !== 'string')
      throw new Error('The login server did not return an email.')
    return {
      id: userInfo.sub,
      email: userInfo.email
    }
  }

  private async persist(refreshToken: string, user: AuthUser): Promise<void> {
    await saveCredentials({ refreshToken, user })
    this.refreshToken = refreshToken
  }

  private async getConfig(): Promise<oidc.Configuration> {
    this.config ??= await oidc.discovery(
      ISSUER,
      CLIENT_ID,
      { token_endpoint_auth_method: 'none' },
      undefined,
      {
        [oidc.customFetch]: (url, options) => net.fetch(url, options as RequestInit)
      }
    )
    return this.config
  }

  private setState(state: AuthState): void {
    this.state = state
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch {
        // A renderer notification failure must not roll back a completed authentication change.
      }
    }
  }
}

function isInvalidGrant(error: unknown): boolean {
  return (error as any)?.error === 'invalid_grant'
}

function messageFor(error: unknown): string {
  if (isInvalidGrant(error)) return '登录状态已失效，请重新登录。'
  if (error instanceof Error && error.message === 'Login timed out.') return '登录已超时，请重试。'
  return '暂时无法连接登录服务，请稍后重试。'
}
