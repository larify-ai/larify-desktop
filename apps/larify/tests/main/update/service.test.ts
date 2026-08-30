import { describe, expect, it, vi } from 'vitest'

const autoUpdater = vi.hoisted(() => ({
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  setFeedURL: vi.fn()
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater }
}))

import {
  checkForUpdates,
  UPDATE_FEED_URL,
  type UpdateChecker
} from '../../../src/main/update/service'

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

  it('checks the CNB generic update feed from a packaged build', async () => {
    await checkForUpdates(true)

    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: UPDATE_FEED_URL,
      useMultipleRangeRequest: false
    })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
  })
})
