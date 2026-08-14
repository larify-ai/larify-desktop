import iconTheme from './assets/ide-icon-theme.json'
import generated from './file-icon-associations.json'

const iconAssetUrls = import.meta.glob<string>(['./assets/dark/*.svg', './assets/light/*.svg'], {
  eager: true,
  import: 'default',
  query: '?url'
})

export const iconAssetUrlBySuffix = new Map(
  Object.entries(iconAssetUrls).map(([path, url]) => [path.slice(path.indexOf('/assets/')), url])
)

type IconDefinition = {
  fontCharacter?: string
  fontColor?: string
  iconPath?: string
}

type IconTheme = {
  file: string
  folder: string
  folderExpanded: string
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  filePatterns: [string, string, boolean][]
}

type ThemeAssociations = Pick<IconTheme, 'fileExtensions' | 'fileNames' | 'filePatterns'>

interface FileIconDefinition {
  character?: string
  color?: string
  url?: string
}

const assetUrl = (iconPath: string): string | undefined => {
  const suffix = `/assets/${iconPath.replace(/^\.\//, '')}`
  return iconAssetUrlBySuffix.get(suffix)
}

const definition = (id: string): FileIconDefinition => {
  const value = (iconTheme.iconDefinitions as Record<string, IconDefinition>)[id]
  const codePoint = value?.fontCharacter?.match(/^\\([0-9a-f]+)$/i)?.[1]
  return {
    character: codePoint
      ? String.fromCodePoint(Number.parseInt(codePoint, 16))
      : value?.fontCharacter,
    color: value?.fontColor,
    url: value?.iconPath ? assetUrl(value.iconPath) : undefined
  }
}

const fileIconId = (name: string, theme: IconTheme): string => {
  const normalized = name.replaceAll('\\', '/').toLowerCase()
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const byName = theme.fileNames[basename]
  if (byName) return byName

  const patternIcon = theme.filePatterns.find(([source, , matchPath]) =>
    patternExpressions.get(source)?.test(matchPath ? normalized : basename)
  )?.[1]
  if (patternIcon) return patternIcon

  const parts = basename.split('.')
  for (let index = 1; index < parts.length; index += 1) {
    const extension = parts.slice(index).join('.')
    const byExtension = theme.fileExtensions[extension]
    if (byExtension) return byExtension
  }
  return theme.file
}

const sourceTheme = iconTheme as unknown as IconTheme & { light: Partial<IconTheme> }
const associations = generated as unknown as ThemeAssociations & { light: ThemeAssociations }
const baseTheme: IconTheme = {
  ...sourceTheme,
  fileExtensions: { ...associations.fileExtensions, ...sourceTheme.fileExtensions },
  fileNames: { ...associations.fileNames, ...sourceTheme.fileNames },
  filePatterns: associations.filePatterns
}
const lightTheme: IconTheme = {
  ...baseTheme,
  ...sourceTheme.light,
  fileExtensions: {
    ...baseTheme.fileExtensions,
    ...associations.light.fileExtensions,
    ...sourceTheme.light.fileExtensions
  },
  fileNames: {
    ...baseTheme.fileNames,
    ...associations.light.fileNames,
    ...sourceTheme.light.fileNames
  },
  filePatterns: associations.light.filePatterns
}
const patternExpressions = new Map(
  [...baseTheme.filePatterns, ...lightTheme.filePatterns].map(([source]) => [
    source,
    new RegExp(source)
  ])
)

export function getFileIcon(
  name: string,
  kind: 'file' | 'folder',
  expanded: boolean,
  light: boolean
): FileIconDefinition {
  const theme = light ? lightTheme : baseTheme
  const id =
    kind === 'folder' ? (expanded ? theme.folderExpanded : theme.folder) : fileIconId(name, theme)
  return definition(id)
}
