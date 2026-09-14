// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  CHANGES_NAVIGATION_EVENT,
  changesRootForFile,
  peekChangesNavigation,
  requestChangesNavigation,
  resolveChangesPath,
  sameChangesPath,
  takeChangesNavigation
} from '../../../../src/extensions/workspace/renderer/changes/changes-navigation'

describe('changes navigation', () => {
  it('resolves repository-relative and absolute paths on Windows and POSIX', () => {
    expect(resolveChangesPath('D:\\项目', '目录/文件.ts')).toBe('D:\\项目\\目录\\文件.ts')
    expect(resolveChangesPath('D:\\项目', 'E:\\其他\\文件.ts')).toBe('E:\\其他\\文件.ts')
    expect(resolveChangesPath('\\\\server\\共享', '目录/文件.ts')).toBe(
      '\\\\server\\共享\\目录\\文件.ts'
    )
    expect(resolveChangesPath('/项目', '目录/文件.ts')).toBe('/项目/目录/文件.ts')
    expect(resolveChangesPath('/项目', '/其他/文件.ts')).toBe('/其他/文件.ts')
  })

  it('uses the containing directory as the root for files outside the workspace', () => {
    expect(changesRootForFile('D:\\repo', 'src/file.ts')).toBe('D:\\repo')
    expect(changesRootForFile('D:\\repo', 'E:\\other\\file.ts')).toBe('E:\\other')
    expect(changesRootForFile('', 'C:\\Users\\test\\notes\\file.md')).toBe(
      'C:\\Users\\test\\notes'
    )
    expect(changesRootForFile('/repo', '/other/file.ts')).toBe('/other')
  })

  it('returns the root unchanged only for files inside it (card in/out decision)', () => {
    // The change card decides 变更页 vs 文件页 by `changesRootForFile(root, file) !== root`.
    // Lock that contract for the real-world cases.
    const root = 'D:\\Workspace\\context-os'
    expect(changesRootForFile(root, 'src/app.ts')).toBe(root) // relative, inside
    expect(changesRootForFile(root, 'D:\\Workspace\\context-os\\src\\app.ts')).toBe(root) // absolute, inside
    expect(
      changesRootForFile(root, 'C:\\Users\\hylnb\\.larify-debug\\.larify\\tasks\\t\\task.md')
    ).not.toBe(root) // tasks artifact, other repository
    expect(changesRootForFile(root, 'E:\\other\\outside.ts')).not.toBe(root) // cross drive
  })

  it('compares paths using the workspace platform rules', () => {
    expect(sameChangesPath('D:\\repo', 'D:\\repo\\File.ts', 'd:\\REPO\\file.ts')).toBe(true)
    expect(sameChangesPath('/repo', '/repo/File.ts', '/repo/file.ts')).toBe(false)
  })

  it('keeps the latest pending selection and emits it', () => {
    const listener = vi.fn()
    const first = { path: 'D:\\repo\\first.ts', resourceId: 42 }
    const latest = { path: 'D:\\repo\\latest.ts', resourceId: 42 }
    window.addEventListener(CHANGES_NAVIGATION_EVENT, listener)

    requestChangesNavigation(first)
    requestChangesNavigation(latest)

    expect(peekChangesNavigation(42)).toBe(latest)
    expect(takeChangesNavigation(42)).toBe(latest)
    expect(peekChangesNavigation(42)).toBeNull()
    expect((listener.mock.calls.at(-1)?.[0] as CustomEvent).detail).toBe(latest)
    window.removeEventListener(CHANGES_NAVIGATION_EVENT, listener)
  })

  it('isolates pending selections by resource', () => {
    const first = { path: '/repo/first.ts', resourceId: 1 }
    const second = { path: '/repo/second.ts', resourceId: 2 }

    requestChangesNavigation(first)
    requestChangesNavigation(second)

    expect(takeChangesNavigation(1)).toBe(first)
    expect(takeChangesNavigation(2)).toBe(second)
  })
})
