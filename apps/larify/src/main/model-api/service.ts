import { app, net } from 'electron'
import { join } from 'node:path'

import type { AuthService } from '../auth/service'
import { getAuthService } from '../auth/service'
import { clearEncryptedJson, readEncryptedJson, writeEncryptedJson } from '../secure-file'
import type { ModelApiBalance, ModelApiCredentials } from '@shared/model-api'

const API_BASE = process.env.LARIFY_API_BASE ?? 'https://larify.ai'

const credentialsPath = (): string => join(app.getPath('userData'), 'model-api.json')

async function loadCredentials(): Promise<ModelApiCredentials | null> {
  try {
    const parsed = await readEncryptedJson(credentialsPath())
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ModelApiCredentials).baseUrl === 'string' &&
      typeof (parsed as ModelApiCredentials).apiKey === 'string'
    ) {
      return parsed as ModelApiCredentials
    }
  } catch {
    // Corrupt/missing cache falls back to a fresh fetch.
  }
  return null
}

async function saveCredentials(credentials: ModelApiCredentials): Promise<void> {
  await writeEncryptedJson(credentialsPath(), credentials)
}

let serviceInstance: ModelApiService | undefined

/**
 * Bridges the desktop client to the Larify model gateway:
 * - credentials: the user's reusable `sk-` API key (fetched once, cached on disk)
 * - balance: wallet + subscription usage (always fresh)
 */
export class ModelApiService {
  constructor(private readonly auth: AuthService = getAuthService()) {}

  /** Synchronous cached credentials for the model runtime (no network). */
  getCachedCredentialsSync(): ModelApiCredentials | null {
    return this.cachedCredentials
  }

  /** Fetches (or refreshes) the user's API credentials from the website. */
  async getCredentials(): Promise<ModelApiCredentials> {
    const accessToken = await this.auth.getAccessToken()
    if (!accessToken) {
      throw new Error(this.authMissingMessage())
    }
    const response = await net.fetch(`${API_BASE}/api/new-api/credentials`, {
      headers: { authorization: `Bearer ${accessToken}` }
    })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      throw new Error(typeof body.error === 'string' ? body.error : '获取模型凭据失败，请稍后重试。')
    }
    if (typeof body.baseUrl !== 'string' || typeof body.apiKey !== 'string') {
      throw new Error('模型服务返回了无效的凭据。')
    }
    const credentials: ModelApiCredentials = {
      baseUrl: body.baseUrl,
      apiKey: body.apiKey
    }
    this.cachedCredentials = credentials
    await saveCredentials(credentials)
    return credentials
  }

  /** Returns the current wallet + subscription usage. */
  async getBalance(): Promise<ModelApiBalance> {
    const accessToken = await this.auth.getAccessToken()
    if (!accessToken) {
      throw new Error(this.authMissingMessage())
    }
    const response = await net.fetch(`${API_BASE}/api/new-api/balance`, {
      headers: { authorization: `Bearer ${accessToken}` }
    })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      throw new Error(typeof body.error === 'string' ? body.error : '获取额度信息失败，请稍后重试。')
    }
    return body as unknown as ModelApiBalance
  }

  /** Distinguishes "signed out" from "signed in but the token refresh failed". */
  private authMissingMessage(): string {
    return this.auth.getState().status === 'authenticated'
      ? '登录状态刷新失败，请稍后重试。'
      : '请先登录后再使用模型功能。'
  }

  /** Loads the on-disk cache into memory (called once at startup). */
  async init(): Promise<void> {
    this.cachedCredentials ??= await loadCredentials()
  }

  /** Clears the cached credentials (e.g. on logout) so another account cannot reuse them. */
  async clear(): Promise<void> {
    this.cachedCredentials = null
    await clearEncryptedJson(credentialsPath()).catch(() => undefined)
  }

  private cachedCredentials: ModelApiCredentials | null = null
}

export function getModelApiService(): ModelApiService {
  serviceInstance ??= new ModelApiService()
  return serviceInstance
}
