import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockedFunction } from 'vitest'
import { createStringSetting } from '../../../../src/renderer/src/app/settings/string-setting'

const KEY = 'test.setting'

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

describe('createStringSetting', () => {
  it('read: 无配置返回空串；有值去除首尾空白', () => {
    const { read } = createStringSetting(KEY)
    expect(read(createStorage())).toBe('')
    expect(read(createStorage({ [KEY]: '  v  ' }))).toBe('v')
  })

  it('read: 值类型意外 / 读取抛异常 / 无 localStorage 时一律安全返回空串', () => {
    const { read } = createStringSetting(KEY)
    const odd = { getItem: vi.fn(() => 42), setItem: vi.fn(), removeItem: vi.fn() }
    expect(read(odd as unknown as StorageMock)).toBe('')
    const throwing = createStorage()
    throwing.getItem.mockImplementation(() => {
      throw new Error('denied')
    })
    expect(read(throwing)).toBe('')
    expect(() => read()).not.toThrow()
    expect(read()).toBe('')
  })

  it('save: 写非空值（去空白）返回 true；留空/纯空白等价清除', () => {
    const { read, save } = createStringSetting(KEY)
    const storage = createStorage()
    expect(save('  v  ', storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(KEY, 'v')
    expect(read(storage)).toBe('v')

    expect(save('', storage)).toBe(true)
    expect(storage.removeItem).toHaveBeenCalledWith(KEY)
    expect(read(storage)).toBe('')
    expect(save('   ', storage)).toBe(true)
    expect(read(storage)).toBe('')
  })

  it('save: 覆盖旧值', () => {
    const { read, save } = createStringSetting(KEY)
    const storage = createStorage({ [KEY]: 'old' })
    expect(save('new', storage)).toBe(true)
    expect(read(storage)).toBe('new')
  })

  it('save: 写入/清除抛异常或存储不可用时返回 false 且不抛错', () => {
    const { read, save } = createStringSetting(KEY)
    const throwing = createStorage()
    throwing.setItem.mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => save('v', throwing)).not.toThrow()
    expect(save('v', throwing)).toBe(false)
    expect(read(throwing)).toBe('')

    const denying = createStorage({ [KEY]: 'v' })
    denying.removeItem.mockImplementation(() => {
      throw new Error('denied')
    })
    expect(save('', denying)).toBe(false)
    expect(read(denying)).toBe('v') // 原值仍在

    expect(save('v')).toBe(false) // 无 localStorage 全局
  })

  it('无参调用在全局 localStorage 可用时读写成功', () => {
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
    const { read, save } = createStringSetting(KEY)
    expect(save('v')).toBe(true)
    expect(read()).toBe('v')
  })

  it('两个 setting 实例互不干扰（各自独立 key）', () => {
    const storage = createStorage()
    createStringSetting('a').save('va', storage)
    createStringSetting('b').save('vb', storage)
    expect(createStringSetting('a').read(storage)).toBe('va')
    expect(createStringSetting('b').read(storage)).toBe('vb')
  })
})
