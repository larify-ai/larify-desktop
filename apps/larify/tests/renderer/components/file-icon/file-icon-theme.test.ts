import { describe, expect, it } from 'vitest'
import { getFileIcon, iconAssetUrlBySuffix } from '@renderer/components/file-icon/file-icon-theme'
import iconTheme from '@renderer/components/file-icon/assets/ide-icon-theme.json'
import generated from '@renderer/components/file-icon/file-icon-associations.json'

const isRenderable = (icon: ReturnType<typeof getFileIcon>): boolean =>
  Boolean(icon.character ?? icon.url)

describe('file icon theme', () => {
  it('resolves file names and compound extensions without Monaco', () => {
    const packageIcon = getFileIcon('package.json', 'file', false, false)
    const tsxIcon = getFileIcon('component.test.tsx', 'file', false, false)
    const defaultIcon = getFileIcon('unknown', 'file', false, false)
    expect(packageIcon.character ?? packageIcon.url).toBeTruthy()
    expect(tsxIcon.character ?? tsxIcon.url).toBeTruthy()
    expect(packageIcon).not.toEqual(defaultIcon)
    expect(tsxIcon).not.toEqual(defaultIcon)
    expect(tsxIcon).not.toEqual(packageIcon)
  })

  it('uses distinct closed and expanded folder assets', () => {
    const closed = getFileIcon('src', 'folder', false, false)
    const expanded = getFileIcon('src', 'folder', true, false)
    expect(closed.url).toBeTruthy()
    expect(expanded.url).toBeTruthy()
    expect(expanded.url).not.toBe(closed.url)
  })

  it('uses the Git icon for ignore files', () => {
    expect(getFileIcon('.gitignore', 'file', false, false)).toEqual(
      getFileIcon('.gitattributes', 'file', false, false)
    )
  })

  it('falls back when a named icon has no renderable glyph or asset', () => {
    const icon = getFileIcon('vite.config.ts', 'file', false, false)
    expect(icon.character ?? icon.url).toBeTruthy()
  })

  it.each([false, true])('renders every mapped filename and extension (light=%s)', (light) => {
    const names = Object.keys({
      ...generated.fileNames,
      ...(light ? generated.light.fileNames : {}),
      ...iconTheme.fileNames,
      ...(light ? iconTheme.light.fileNames : {})
    })
    const extensions = Object.keys({
      ...generated.fileExtensions,
      ...(light ? generated.light.fileExtensions : {}),
      ...iconTheme.fileExtensions,
      ...(light ? iconTheme.light.fileExtensions : {})
    }).map((extension) => `file.${extension}`)

    expect(
      [...names, ...extensions].filter(
        (name) => !isRenderable(getFileIcon(name, 'file', false, light))
      )
    ).toEqual([])
  })

  it('bundles every image asset referenced by the theme', () => {
    const paths = Object.values(iconTheme.iconDefinitions).flatMap((definition) =>
      'iconPath' in definition && definition.iconPath ? [definition.iconPath] : []
    )
    const missing = paths.filter((path) => {
      const suffix = `/assets/${path.replace(/^\.\//, '')}`
      return !iconAssetUrlBySuffix.has(suffix)
    })
    expect(missing).toEqual([])
  })
})
