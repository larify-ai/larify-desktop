import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockedFunction } from 'vitest'
import { readOwnApiKey, saveOwnApiKey } from '../../../../src/renderer/src/app/settings/api-key'

const STORAGE_KEY = 'larify.settings.apiKey'

type StorageMethods = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

type StorageMock = { [K in keyof StorageMethods]: MockedFunction<StorageMethods[K]> }

/** 最小内存版 Storage，方法全部包上 vi.fn 以便断言调用。 */
function createStorage(initial: Record<string, string> = {}): StorageMock {
  const map = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key: string) => (map.has(key) ? (map.get(key) as string) : null)),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key)
    })
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readOwnApiKey', () => {
  it('无配置时返回空串', () => {
    const storage = createStorage()
    expect(readOwnApiKey(storage)).toBe('')
  })

  it('返回已存 Key 并去除首尾空白', () => {
    const storage = createStorage({ [STORAGE_KEY]: '  sk-abc  ' })
    expect(readOwnApiKey(storage)).toBe('sk-abc')
  })

  it('存储值为意外类型时按空处理', () => {
    const storage = { getItem: vi.fn(() => 42), setItem: vi.fn(), removeItem: vi.fn() }
    expect(readOwnApiKey(storage as unknown as StorageMock)).toBe('')
  })

  it('存储读取抛异常时静默返回空串', () => {
    const storage = createStorage()
    storage.getItem.mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => readOwnApiKey(storage)).not.toThrow()
    expect(readOwnApiKey(storage)).toBe('')
  })

  it('node 环境无 localStorage 全局时，无参调用安全返回空串（默认存储守卫）', () => {
    expect(() => readOwnApiKey()).not.toThrow()
    expect(readOwnApiKey()).toBe('')
  })

  it('全局 localStorage 可用时，无参调用读取到已存 Key', () => {
    const map = new Map([[STORAGE_KEY, 'sk-global']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        map.set(key, value)
      },
      removeItem: (key: string) => {
        map.delete(key)
      }
    })
    expect(readOwnApiKey()).toBe('sk-global')
  })
})

describe('saveOwnApiKey', () => {
  it('写入非空 Key：返回 true（操作成功）且去除首尾空白', () => {
    const storage = createStorage()
    expect(saveOwnApiKey('  sk-new  ', storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'sk-new')
    expect(readOwnApiKey(storage)).toBe('sk-new')
  })

  it('留空清除已有配置：返回 true 表示清除操作成功', () => {
    const storage = createStorage({ [STORAGE_KEY]: 'sk-abc' })
    expect(saveOwnApiKey('', storage)).toBe(true)
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY)
    expect(readOwnApiKey(storage)).toBe('')
  })

  it('纯空白同样视为清除', () => {
    const storage = createStorage({ [STORAGE_KEY]: 'sk-abc' })
    expect(saveOwnApiKey('   ', storage)).toBe(true)
    expect(readOwnApiKey(storage)).toBe('')
  })

  it('覆盖旧 Key', () => {
    const storage = createStorage({ [STORAGE_KEY]: 'sk-old' })
    expect(saveOwnApiKey('sk-new', storage)).toBe(true)
    expect(readOwnApiKey(storage)).toBe('sk-new')
  })

  it('写入抛异常时返回 false（什么都没做成）且不抛错', () => {
    const storage = createStorage()
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveOwnApiKey('sk-abc', storage)).not.toThrow()
    expect(saveOwnApiKey('sk-abc', storage)).toBe(false)
    expect(readOwnApiKey(storage)).toBe('')
  })

  it('清除抛异常时返回 false，调用方可知"清除失败"而非误以为已清除', () => {
    const storage = createStorage({ [STORAGE_KEY]: 'sk-abc' })
    storage.removeItem.mockImplementation(() => {
      throw new Error('denied')
    })
    expect(saveOwnApiKey('', storage)).toBe(false)
    expect(readOwnApiKey(storage)).toBe('sk-abc') // 原值仍在
  })

  it('node 环境无 localStorage 全局时，无参保存返回 false 且不抛错', () => {
    expect(() => saveOwnApiKey('sk-abc')).not.toThrow()
    expect(saveOwnApiKey('sk-abc')).toBe(false)
  })

  it('全局 localStorage 可用时，无参保存写入成功', () => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        map.set(key, value)
      },
      removeItem: (key: string) => {
        map.delete(key)
      }
    })
    expect(saveOwnApiKey('sk-global')).toBe(true)
    expect(readOwnApiKey()).toBe('sk-global')
  })
})
