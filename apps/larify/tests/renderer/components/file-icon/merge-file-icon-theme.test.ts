import { describe, expect, it } from 'vitest'
import iconTheme from '@renderer/components/file-icon/assets/ide-icon-theme.json'
import checkedIn from '@renderer/components/file-icon/file-icon-associations.json'
import mappings from '@renderer/components/file-icon/vscode-language-mappings.json'
import {
  generateFileIconAssociations,
  globRegExpSource
} from '../../../../scripts/merge-file-icon-theme.mjs'

const generated = generateFileIconAssociations(iconTheme, mappings)

const exampleForPattern = (pattern: string): string =>
  pattern.replaceAll('**', 'nested').replaceAll('*', 'sample').replaceAll('?', 'x')

describe('generate file icon associations', () => {
  it('does not override explicit theme mappings', () => {
    const theme = {
      fileExtensions: { ts: 'explicit-typescript' },
      fileNames: { dockerfile: 'explicit-docker' },
      languageIds: { typescript: 'generated' },
      light: {
        fileExtensions: { mts: 'light-explicit' },
        fileNames: {},
        languageIds: {}
      }
    }
    const languageMappings = {
      languages: {
        typescript: {
          extensions: ['.ts', '.mts', '.cts'],
          fileNames: ['Dockerfile', 'TSConfig.json'],
          fileNamePatterns: ['compose.yaml', 'compose.*.yaml']
        }
      }
    }

    const result = generateFileIconAssociations(theme, languageMappings)

    expect(result.fileExtensions).toEqual({ cts: 'generated', mts: 'generated' })
    expect(result.fileNames).toEqual({
      'compose.yaml': 'generated',
      'tsconfig.json': 'generated'
    })
    expect(result.light.fileExtensions).toEqual({ cts: 'generated' })
  })

  it('drops associations removed from the source mappings', () => {
    const theme = {
      fileExtensions: {},
      fileNames: {},
      languageIds: { language: 'icon' }
    }
    const oldMappings = {
      languages: {
        language: { extensions: ['.old'], fileNames: ['old.name'], fileNamePatterns: [] }
      }
    }
    const newMappings = {
      languages: {
        language: { extensions: ['.new'], fileNames: ['new.name'], fileNamePatterns: [] }
      }
    }

    expect(generateFileIconAssociations(theme, oldMappings).fileExtensions).toHaveProperty('old')
    const result = generateFileIconAssociations(theme, newMappings)
    expect(result.fileExtensions).toEqual({ new: 'icon' })
    expect(result.fileNames).toEqual({ 'new.name': 'icon' })
  })

  it('only generates declared icon ids', () => {
    const definitions = new Set(Object.keys(iconTheme.iconDefinitions))
    const ids = [
      ...Object.values(generated.fileNames),
      ...Object.values(generated.fileExtensions),
      ...generated.filePatterns.map(([, iconId]) => iconId),
      ...Object.values(generated.light.fileNames),
      ...Object.values(generated.light.fileExtensions),
      ...generated.light.filePatterns.map(([, iconId]) => iconId)
    ]
    expect(ids.filter((iconId) => !definitions.has(iconId))).toEqual([])
  })

  it('generates valid regular expressions for every filename pattern', () => {
    const failures: string[] = []
    for (const [languageId, mapping] of Object.entries(mappings.languages)) {
      const iconId = iconTheme.languageIds[languageId as keyof typeof iconTheme.languageIds]
      if (!iconId) continue
      for (const pattern of mapping.fileNamePatterns.filter(
        (pattern) => pattern.includes('/') || /[*?]/.test(pattern)
      )) {
        const source = globRegExpSource(pattern.toLowerCase())
        const association = generated.filePatterns.find(([candidate]) => candidate === source)
        if (
          association?.[1] !== iconId ||
          !new RegExp(source).test(exampleForPattern(pattern).toLowerCase())
        ) {
          failures.push(`${languageId}: ${pattern}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('is deterministic', () => {
    expect(generateFileIconAssociations(iconTheme, mappings)).toEqual(generated)
  })

  it('matches the checked-in generated associations', () => {
    expect(checkedIn).toEqual(generated)
  })
})
