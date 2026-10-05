import { describe, expect, it } from 'vitest'
import {
  readMemoryRepo,
  saveMemoryRepo
} from '../../../../src/renderer/src/app/settings/memory-repo'

/**
 * 读写语义（留空=清除 / 去空白 / 异常静默 / 无 localStorage 降级）由
 * `string-setting.test.ts` 全面覆盖——两者共用同一实现，不重复测。
 * 这里只钉死**接线**：存储 key 正确，防止改错 key 而静默失联。
 */
describe('memory-repo 存储接线', () => {
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

  it('使用 larify.settings.memoryRepo 作为存储 key', () => {
    const store = memoryStorage()
    saveMemoryRepo('https://github.com/user/memory.git', store)
    expect(store.getItem('larify.settings.memoryRepo')).toBe('https://github.com/user/memory.git')
    expect(readMemoryRepo(store)).toBe('https://github.com/user/memory.git')
  })

  it('未配置时返回空串', () => {
    expect(readMemoryRepo(memoryStorage())).toBe('')
  })
})
