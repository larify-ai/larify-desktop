import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureLarifyPath: vi.fn((directory: string) => directory)
}))

vi.mock('../../../../src/main/utils/app-paths', () => mocks)

import { memoryIndexPath, memoryRootPath } from '../../../../src/extensions/context/main/indexer'

describe('context memory paths', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores memory under the shared Larify directory', () => {
    expect(memoryRootPath()).toBe('memory')
    expect(mocks.ensureLarifyPath).toHaveBeenCalledWith('memory')
  })

  it('creates the shared index directory before resolving the database path', () => {
    expect(memoryIndexPath()).toMatch(/indexes[\\/]memory\.db$/)
    expect(mocks.ensureLarifyPath).toHaveBeenCalledWith('indexes')
  })
})
