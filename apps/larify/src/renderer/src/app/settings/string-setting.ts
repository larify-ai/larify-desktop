/**
 * 渲染层 localStorage 里「一个可选字符串设置」的通用读写。
 *
 * 目前承载两项用户偏好：DeepSeek API Key（`api-key.ts`）与记忆存储地址（`memory-repo.ts`）。
 * 二者的语义完全一致——**留空 = 清除**、异常静默、无 localStorage 时安全降级——故抽到此一处，
 * 各设置文件只声明自己的 key 并导出语义化别名。
 */

type StringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * 解析默认存储。不能写成默认参数 `storage = localStorage`：默认参数在函数体
 * 之前求值，node/SSR 等无该全局标识符的环境会直接 ReferenceError，且逃过
 * 函数内的 try/catch。`typeof` 探测不会因标识符缺失而抛错。
 */
function defaultStorage(): StringStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export interface StringSetting {
  /** 读取并去除首尾空白；未配置 / 存储不可用 / 异常时一律返回空串。 */
  read(storage?: StringStorage): string
  /** 写入（去除首尾空白）；**留空等价于清除**。返回值仅表示操作是否成功。 */
  save(value: string, storage?: StringStorage): boolean
}

export function createStringSetting(key: string): StringSetting {
  return {
    read(storage) {
      try {
        const store = storage ?? defaultStorage()
        if (!store) return ''
        const value = store.getItem(key)
        return typeof value === 'string' ? value.trim() : ''
      } catch {
        return ''
      }
    },
    save(value, storage) {
      const trimmed = value.trim()
      try {
        const store = storage ?? defaultStorage()
        if (!store) return false
        if (trimmed) store.setItem(key, trimmed)
        else store.removeItem(key)
      } catch {
        return false
      }
      return true
    }
  }
}
