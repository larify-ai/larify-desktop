import { describe, expect, it } from 'vitest'
import { readOwnApiKey, saveOwnApiKey } from '../../../../src/renderer/src/app/settings/api-key'

/**
 * 读写语义由 `string-setting.test.ts` 全面覆盖（两者共用同一实现）。
 * 这里只钉死**接线**：存储 key 正确，防止改错 key 而静默失联。
 */
describe('api-key 存储接线', () => {
  function memoryStorage(): Storage {
    const map = new Map<string, string>()
    return {
      getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
      clear: () => map.clear(),
      key: () => null,
      length: 0
    } as Storage
  }

  it('使用 larify.settings.apiKey 作为存储 key', () => {
    const store = memoryStorage()
    saveOwnApiKey('sk-abc', store)
    expect(store.getItem('larify.settings.apiKey')).toBe('sk-abc')
    expect(readOwnApiKey(store)).toBe('sk-abc')
  })

  it('未配置时返回空串', () => {
    expect(readOwnApiKey(memoryStorage())).toBe('')
  })
})
