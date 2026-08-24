import { describe, expect, it, vi } from 'vitest'
import { status } from '../../../../src/main/core/git/status'

describe('Git status', () => {
  it('disables optional locks for background status reads', async () => {
    const root = `D:\\git-status-${Date.now()}`
    const git = {
      checkIsRepo: vi.fn(async () => true),
      env: vi.fn(),
      raw: vi.fn(async () => ''),
      revparse: vi.fn(async () => root),
      status: vi.fn(async () => ({ files: [] }))
    }
    const runtime = { open: vi.fn(async () => git) }

    await status(root, runtime as never)

    expect(git.env).toHaveBeenCalledWith('GIT_OPTIONAL_LOCKS', '0')
  })
})
