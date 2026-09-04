/**
 * 用户自带的 DeepSeek 官方 API Key。
 *
 * 存在渲染层 localStorage：配了 Key 的请求直连官方、不走 Larify 网关（见 transport.ts），
 * 主进程不落盘、不写日志。Key 只在真正发请求时由渲染层读取、临时附加到 modelConfig，
 * 不会随模型选择一起写进其他 localStorage 条目。
 */

const API_KEY_STORAGE_KEY = 'larify.settings.apiKey'

type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * 解析默认存储。不能写成默认参数 `storage = localStorage`：默认参数在函数体
 * 之前求值，node/SSR 等无该全局标识符的环境会直接 ReferenceError，且逃过
 * 函数内的 try/catch。`typeof` 探测不会因标识符缺失而抛错。
 */
function defaultStorage(): KeyStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readOwnApiKey(storage?: KeyStorage): string {
  try {
    const store = storage ?? defaultStorage()
    if (!store) return ''
    const value = store.getItem(API_KEY_STORAGE_KEY)
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    return ''
  }
}

/**
 * 保存用户填写的 API Key。留空等价于清除配置（恢复走账号额度）。
 *
 * @returns 存储操作是否成功：true = 已写入或已清除；false = 存储不可用，什么都没做成。
 * 调用方不要用返回值判断"当前有没有 Key"——那属于 readOwnApiKey 的职责。
 */
export function saveOwnApiKey(apiKey: string, storage?: KeyStorage): boolean {
  const trimmed = apiKey.trim()
  try {
    const store = storage ?? defaultStorage()
    if (!store) return false
    if (trimmed) store.setItem(API_KEY_STORAGE_KEY, trimmed)
    else store.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    return false
  }
  return true
}
