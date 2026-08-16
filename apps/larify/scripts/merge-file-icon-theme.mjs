/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultTheme = path.join(
  appRoot,
  'src/renderer/src/components/file-icon/assets/ide-icon-theme.json'
)
const defaultMappings = path.join(
  appRoot,
  'src/renderer/src/components/file-icon/vscode-language-mappings.json'
)
const defaultOutput = path.join(
  appRoot,
  'src/renderer/src/components/file-icon/file-icon-associations.json'
)
const genericMarkdownFileNames = new Set(['skill.md'])

export const globRegExpSource = (pattern) => {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*' && pattern[index + 1] === '*') {
      const followedBySlash = pattern[index + 2] === '/'
      source += followedBySlash ? '(?:.*/)?' : '.*'
      index += followedBySlash ? 2 : 1
    } else if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return `^${source}$`
}

const associations = (languages, languageIds, protectedNames, protectedExtensions) => {
  const fileNames = {}
  const fileExtensions = {}

  for (const [languageId, mapping] of Object.entries(languages)) {
    const iconId = languageIds[languageId]
    if (!iconId) continue

    const literalPatterns = mapping.fileNamePatterns.filter(
      (pattern) => !pattern.includes('/') && !/[*?]/.test(pattern)
    )
    for (const name of [...mapping.fileNames, ...literalPatterns]) {
      const key = name.toLowerCase()
      if (!protectedNames.has(key) && !genericMarkdownFileNames.has(key)) fileNames[key] ??= iconId
    }

    for (const extension of mapping.extensions) {
      const key = extension.replace(/^\./, '').toLowerCase()
      if (key && !/[*?]/.test(key) && !protectedExtensions.has(key)) {
        fileExtensions[key] ??= iconId
      }
    }
  }

  const filePatterns = Object.entries(languages).flatMap(([languageId, mapping]) => {
    const iconId = languageIds[languageId]
    if (!iconId) return []
    return mapping.fileNamePatterns
      .filter((pattern) => pattern.includes('/') || /[*?]/.test(pattern))
      .map((pattern) => [globRegExpSource(pattern.toLowerCase()), iconId, pattern.includes('/')])
  })

  return { fileExtensions, fileNames, filePatterns }
}

export const generateFileIconAssociations = (theme, mappings) => {
  const baseNames = new Set(Object.keys(theme.fileNames ?? {}))
  const baseExtensions = new Set(Object.keys(theme.fileExtensions ?? {}))
  const lightNames = new Set(Object.keys(theme.light?.fileNames ?? {}))
  const lightExtensions = new Set(Object.keys(theme.light?.fileExtensions ?? {}))

  return {
    ...associations(mappings.languages, theme.languageIds ?? {}, baseNames, baseExtensions),
    light: associations(
      mappings.languages,
      { ...theme.languageIds, ...theme.light?.languageIds },
      new Set([...baseNames, ...lightNames]),
      new Set([...baseExtensions, ...lightExtensions])
    )
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const themePath = path.resolve(process.argv[2] ?? defaultTheme)
  const mappingsPath = path.resolve(process.argv[3] ?? defaultMappings)
  const outputPath = path.resolve(process.argv[4] ?? defaultOutput)
  const theme = JSON.parse(await readFile(themePath, 'utf8'))
  const mappings = JSON.parse(await readFile(mappingsPath, 'utf8'))
  const generated = generateFileIconAssociations(theme, mappings)
  await writeFile(outputPath, `${JSON.stringify(generated, null, 2)}\n`, 'utf8')
}
