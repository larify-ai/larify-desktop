import { waitMs } from "./waits"
import type { BrowserTab } from "./tab"

/**
 * 瞬时网络错误（DNS/TLS/连接被重置/连接超时等），重试一次通常即可成功。
 *
 * 注意：`ERR_CONNECTION_TIMED_OUT` 与 `ERR_TIMED_OUT` 都是连接超时类瞬时错误，
 * 必须显式列出（`CONNECTION_` 前缀无法被无前缀的 `TIMED_OUT` 分支匹配）。
 * `ERR_CONNECTION_REFUSED`（服务端主动拒绝）、`ERR_NAME_NOT_RESOLVED`（DNS 配置
 * 问题）不视为瞬时错误，不重试。
 */
export const TRANSIENT_NAVIGATION_ERROR =
  /ERR_(?:SOCKET_NOT_CONNECTED|NETWORK_CHANGED|CONNECTION_(?:RESET|CLOSED|TIMED_OUT)|TIMED_OUT)/

const NAVIGATION_RETRY_ATTEMPTS = 2
const NAVIGATION_RETRY_DELAY_MS = 300

/**
 * 对瞬时网络错误（ERR_SOCKET_NOT_CONNECTED / ERR_NETWORK_CHANGED /
 * ERR_CONNECTION_RESET / ERR_CONNECTION_CLOSED / ERR_CONNECTION_TIMED_OUT /
 * ERR_TIMED_OUT 等）自动重试一次，缓解网络抖动导致的「偶尔导航失败/超时」。
 *
 * 注意：页面加载超时（"navigation load event timed out"）不属于瞬时网络错误，
 * 不重试，避免对一直加载不完的页面反复等待。
 */
export async function navigateAndWaitWithRetry(
  tab: BrowserTab,
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < NAVIGATION_RETRY_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error("browser navigation was cancelled")
    try {
      await tab.navigateAndWait(url)
      return
    } catch (error) {
      lastError = error
      const isTransient =
        error instanceof Error && TRANSIENT_NAVIGATION_ERROR.test(error.message)
      if (!isTransient || attempt === NAVIGATION_RETRY_ATTEMPTS - 1) throw error
      await waitMs(NAVIGATION_RETRY_DELAY_MS, signal)
    }
  }
  throw lastError
}
