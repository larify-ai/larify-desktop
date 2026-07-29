import { describe, expect, it } from 'vitest'
import { toggleSessionGroup } from '../../../../src/extensions/assistant/renderer/lib/session-groups'

describe('session group state', () => {
  it('resets show-all state when a group is collapsed', () => {
    const group = 'D:/Workspace/larify-desktop'
    const collapsed = toggleSessionGroup(new Set([group]), new Set([group]), group)

    expect(collapsed.open.has(group)).toBe(false)
    expect(collapsed.expanded.has(group)).toBe(false)

    const reopened = toggleSessionGroup(collapsed.open, collapsed.expanded, group)
    expect(reopened.open.has(group)).toBe(true)
    expect(reopened.expanded.has(group)).toBe(false)
  })
})
