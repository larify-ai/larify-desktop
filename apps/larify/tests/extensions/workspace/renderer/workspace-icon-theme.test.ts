import { describe, expect, it } from 'vitest'
import { getWorkspaceIcon } from '../../../../src/extensions/workspace/renderer/workspace-icon-theme'

describe('workspace icon theme', () => {
  it('resolves file names and compound extensions without Monaco', () => {
    const packageIcon = getWorkspaceIcon('package.json', 'file', false, false)
    const tsxIcon = getWorkspaceIcon('component.test.tsx', 'file', false, false)
    const defaultIcon = getWorkspaceIcon('unknown', 'file', false, false)
    expect(packageIcon.character ?? packageIcon.url).toBeTruthy()
    expect(tsxIcon.character ?? tsxIcon.url).toBeTruthy()
    expect(packageIcon).not.toEqual(defaultIcon)
    expect(tsxIcon).not.toEqual(defaultIcon)
    expect(tsxIcon).not.toEqual(packageIcon)
  })

  it('uses distinct closed and expanded folder assets', () => {
    const closed = getWorkspaceIcon('src', 'folder', false, false)
    const expanded = getWorkspaceIcon('src', 'folder', true, false)
    expect(closed.url).toBeTruthy()
    expect(expanded.url).toBeTruthy()
    expect(expanded.url).not.toBe(closed.url)
  })

  it('uses the Git icon for ignore files', () => {
    expect(getWorkspaceIcon('.gitignore', 'file', false, false)).toEqual(
      getWorkspaceIcon('.gitattributes', 'file', false, false)
    )
  })

  it('falls back when a named icon has no renderable glyph or asset', () => {
    const icon = getWorkspaceIcon('vite.config.ts', 'file', false, false)
    expect(icon.character ?? icon.url).toBeTruthy()
  })
})
