import { describe, expect, it, vi } from 'vitest'
import { checkForUpdates, type UpdateChecker } from '../../../src/main/update/service'

describe('checkForUpdates', () => {
  it('does not check from a development build', async () => {
    const updater: UpdateChecker = { checkForUpdates: vi.fn() }

    await checkForUpdates(false, updater)

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks silently from a packaged build', async () => {
    const updater: UpdateChecker = {
      checkForUpdates: vi.fn().mockResolvedValue(undefined)
    }

    await checkForUpdates(true, updater)

    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  })
})
