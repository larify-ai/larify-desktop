// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  requestWorkspaceNavigation,
  takeWorkspaceNavigation
} from '../../../../src/extensions/workspace/renderer/workspace-navigation'

describe('workspace navigation', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('stores, dispatches, and consumes a pending navigation once', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const request = { path: '/workspace/a.ts', hash: 'L2', resourceId: 7 }

    requestWorkspaceNavigation(request)

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'larify:workspace-navigation' })
    )
    expect(takeWorkspaceNavigation(7)).toEqual(request)
    expect(takeWorkspaceNavigation(7)).toBeNull()
  })

  it('keeps only the latest request for each resource', () => {
    const first = { path: '/workspace/first.ts', resourceId: 7 }
    const latest = { path: '/workspace/latest.ts', resourceId: 7 }
    const other = { path: '/workspace/other.ts', resourceId: 8 }

    requestWorkspaceNavigation(first)
    requestWorkspaceNavigation(other)
    requestWorkspaceNavigation(latest)

    expect(takeWorkspaceNavigation(7)).toEqual(latest)
    expect(takeWorkspaceNavigation(8)).toEqual(other)
  })

  it('preserves a directory request while dispatching and consuming it', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const request = {
      kind: 'directory' as const,
      path: 'D:\\Workspace\\folder',
      resourceId: 9
    }

    requestWorkspaceNavigation(request)

    const event = dispatch.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual(request)
    expect(takeWorkspaceNavigation(9)).toEqual(request)
    expect(takeWorkspaceNavigation(9)).toBeNull()
  })
})
