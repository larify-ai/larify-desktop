// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gitClient } from '../../../../src/extensions/workspace/renderer/git-client'

const invoke = vi.fn()

describe('git client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.bridge = { invoke } as never
  })

  it('forwards status requests and returns their result', async () => {
    const statuses = [{ path: 'src/file.ts', index: ' ', working_dir: 'M' }]
    invoke.mockResolvedValue(statuses)

    await expect(gitClient.status('D:\\workspace')).resolves.toBe(statuses)
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('git:status', 'D:\\workspace')
  })
})
