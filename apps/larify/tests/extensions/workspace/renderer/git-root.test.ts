import { describe, expect, it } from 'vitest'
import { normalizeGitRoot } from '../../../../src/extensions/workspace/renderer/changes/git-root'

describe('normalizeGitRoot', () => {
  it.each([
    ['D:\\Workspace\\repo\\', 'd:/workspace/repo'],
    ['d:/workspace/repo/', 'd:/workspace/repo'],
    ['\\\\Server\\Share\\repo\\', '//server/share/repo'],
    ['/workspace/repo/', '/workspace/repo']
  ])('normalizes equivalent Git root %s', (root, expected) => {
    expect(normalizeGitRoot(root)).toBe(expected)
  })

  it.each([
    ['C:\\', 'c:/'],
    ['C:/', 'c:/'],
    ['/', '/'],
    ['///', '/'],
    ['', '']
  ])('preserves filesystem root %s', (root, expected) => {
    expect(normalizeGitRoot(root)).toBe(expected)
  })

  it('keeps a drive-relative path distinct from its drive root', () => {
    expect(normalizeGitRoot('C:')).toBe('c:')
    expect(normalizeGitRoot('C:')).not.toBe(normalizeGitRoot('C:\\'))
  })
})
