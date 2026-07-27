import { iconAssetUrlBySuffix, iconTheme } from './ide-icon-assets'
import { languageIdForFile } from './language-associations'

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
  languageIds?: Record<string, string>
}

export interface WorkspaceIconDefinition {
  character?: string
  color?: string
  url?: string
}

const assetUrl = (iconPath: string): string | undefined => {
  const suffix = `/assets/ide-icons/${iconPath.replace(/^\.\//, '')}`
  return iconAssetUrlBySuffix.get(suffix)
}

const definition = (id: string): WorkspaceIconDefinition => {
  const value = (iconTheme.iconDefinitions as Record<string, IconDefinition>)[id]
  return {
    character: value?.fontCharacter,
    color: value?.fontColor,
    url: value?.iconPath ? assetUrl(value.iconPath) : undefined
  }
}

const fileIconId = (name: string, theme: IconTheme): string => {
  const normalized = name.toLowerCase()
  const byName = theme.fileNames[normalized]
  if (byName) return byName

  const parts = normalized.split('.')
  for (let index = 1; index < parts.length; index += 1) {
    const extension = parts.slice(index).join('.')
    const byExtension = theme.fileExtensions[extension]
    if (byExtension) return byExtension
  }
  const language = languageIdForFile(normalized)
  const byLanguage = language ? theme.languageIds?.[language] : undefined
  if (byLanguage) return byLanguage
  return theme.file
}

export function getWorkspaceIcon(
  name: string,
  kind: 'file' | 'folder',
  expanded: boolean,
  light: boolean
): WorkspaceIconDefinition {
  const base = iconTheme as unknown as IconTheme & { light: Partial<IconTheme> }
  const theme = light
    ? {
        ...base,
        ...base.light,
        fileExtensions: { ...base.fileExtensions, ...base.light.fileExtensions },
        fileNames: { ...base.fileNames, ...base.light.fileNames },
        languageIds: { ...base.languageIds, ...base.light.languageIds }
      }
    : base
  const id =
    kind === 'folder' ? (expanded ? theme.folderExpanded : theme.folder) : fileIconId(name, theme)
  return definition(id)
}
