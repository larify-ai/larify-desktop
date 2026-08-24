// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  invalidateGitStatus,
  onGitStatusInvalidated
} from '../../../../src/extensions/workspace/renderer/changes/git-status-invalidation'

describe('Git status invalidation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('matches equivalent Windows roots and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = onGitStatusInvalidated('D:\\workspace', listener)

    invalidateGitStatus('d:/workspace///')
    invalidateGitStatus('D:/other')
    expect(listener).toHaveBeenCalledOnce()

    unsubscribe()
    invalidateGitStatus('D:/workspace')
    expect(listener).toHaveBeenCalledOnce()
  })

  it('ignores malformed events', () => {
    const listener = vi.fn()
    const unsubscribe = onGitStatusInvalidated('D:/workspace', listener)

    window.dispatchEvent(new CustomEvent('larify:git-status-invalidate'))
    window.dispatchEvent(new CustomEvent('larify:git-status-invalidate', { detail: { root: 42 } }))

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('is safe when no browser window exists', () => {
    vi.stubGlobal('window', undefined)
    expect(() => invalidateGitStatus('D:/workspace')).not.toThrow()
    expect(() => onGitStatusInvalidated('D:/workspace', vi.fn())()).not.toThrow()
  })
})
