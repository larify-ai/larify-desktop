import { describe, expect, it, vi } from 'vitest'
import { checkForUpdates, type UpdateChecker } from '../../../src/main/update/service'

describe('checkForUpdates', () => {
  it('does not check from a development build', async () => {
    const updater: UpdateChecker = { checkForUpdatesAndNotify: vi.fn() }

    await checkForUpdates(false, updater)

    expect(updater.checkForUpdatesAndNotify).not.toHaveBeenCalled()
  })

  it('checks and notifies from a packaged build', async () => {
    const updater: UpdateChecker = {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined)
    }

    await checkForUpdates(true, updater)

    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledOnce()
  })
})
