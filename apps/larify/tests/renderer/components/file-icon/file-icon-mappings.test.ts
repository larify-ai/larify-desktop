import { describe, expect, it } from 'vitest'
import iconTheme from '@renderer/components/file-icon/assets/ide-icon-theme.json'
import generatedMappings from '@renderer/components/file-icon/vscode-language-mappings.json'

const fileLanguageMappings = generatedMappings.languages

describe('file icon mappings', () => {
  it('records the exact official VS Code source revision and inventory', () => {
    expect(generatedMappings.source).toEqual({
      repository: 'https://github.com/microsoft/vscode',
      revision: expect.stringMatching(/^[0-9a-f]{40}$/)
    })
    expect({
      extensions: Object.values(fileLanguageMappings).reduce(
        (count, mapping) => count + mapping.extensions.length,
        0
      ),
      fileNamePatterns: Object.values(fileLanguageMappings).reduce(
        (count, mapping) => count + mapping.fileNamePatterns.length,
        0
      ),
      fileNames: Object.values(fileLanguageMappings).reduce(
        (count, mapping) => count + mapping.fileNames.length,
        0
      ),
      languages: Object.keys(fileLanguageMappings).length
    }).toEqual({ extensions: 342, fileNamePatterns: 26, fileNames: 71, languages: 74 })
  })

  it('makes builtin languages without a dedicated theme icon explicit', () => {
    const languageIds = new Set(Object.keys(iconTheme.languageIds))
    const fallbackLanguageIds = Object.keys(fileLanguageMappings).filter(
      (id) => !languageIds.has(id)
    )

    expect(fallbackLanguageIds).toEqual([
      'bibtex',
      'cpp_embedded_latex',
      'diff',
      'git-rebase',
      'hlsl',
      'ini',
      'jsx-tags',
      'juliamarkdown',
      'log',
      'markdown_latex_combined',
      'markdown-math',
      'raku',
      'restructuredtext',
      'shaderlab',
      'snippets',
      'vb',
      'xsl'
    ])
  })

  it('makes non-builtin theme language ids explicit', () => {
    const builtinIds = new Set(Object.keys(fileLanguageMappings))
    expect(Object.keys(iconTheme.languageIds).filter((id) => !builtinIds.has(id))).toEqual([
      'argdown',
      'bicep',
      'elixir',
      'elm',
      'erb',
      'github-issues',
      'gradle',
      'godot',
      'haml',
      'haskell',
      'haxe',
      'jinja',
      'kotlin',
      'mustache',
      'nunjucks',
      'ocaml',
      'rescript',
      'sass',
      'stylus',
      'terraform',
      'todo',
      'vala',
      'vue',
      'postcss',
      'django-html',
      'blade',
      'CommandLabel',
      'SettingSet',
      'SettingView'
    ])
  })

  it.each([
    ['extension', 'extensions'],
    ['filename', 'fileNames'],
    ['filename pattern', 'fileNamePatterns']
  ] as const)('does not assign a %s to multiple languages', (_, field) => {
    const owners = new Map<string, string>()
    const conflicts: string[] = []

    for (const [language, mapping] of Object.entries(fileLanguageMappings)) {
      for (const association of mapping[field]) {
        const owner = owners.get(association)
        if (owner) conflicts.push(`${association}: ${owner}, ${language}`)
        owners.set(association, language)
      }
    }

    expect(conflicts).toEqual([])
  })
})
