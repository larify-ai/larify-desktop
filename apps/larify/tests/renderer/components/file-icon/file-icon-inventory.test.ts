import { describe, expect, it } from 'vitest'
import iconTheme from '@renderer/components/file-icon/assets/ide-icon-theme.json'
import generated from '@renderer/components/file-icon/file-icon-associations.json'

const mappings = (
  primary: Record<string, string>,
  secondary: Record<string, string>
): Record<string, string> => ({ ...primary, ...secondary })

describe('file icon inventory', () => {
  const definitions = iconTheme.iconDefinitions
  const extensionMappings = mappings(
    { ...generated.fileExtensions, ...iconTheme.fileExtensions },
    { ...generated.light.fileExtensions, ...iconTheme.light.fileExtensions }
  )
  const fileNameMappings = mappings(
    { ...generated.fileNames, ...iconTheme.fileNames },
    { ...generated.light.fileNames, ...iconTheme.light.fileNames }
  )
  const languageMappings = mappings(iconTheme.languageIds, iconTheme.light.languageIds)
  const referencedIds = new Set([
    iconTheme.file,
    iconTheme.folder,
    iconTheme.folderExpanded,
    iconTheme.light.file,
    iconTheme.light.folder,
    iconTheme.light.folderExpanded,
    ...Object.values(extensionMappings),
    ...Object.values(fileNameMappings),
    ...Object.values(languageMappings),
    ...generated.filePatterns.map(([, iconId]) => iconId),
    ...generated.light.filePatterns.map(([, iconId]) => iconId)
  ])

  it('extracts every kind of mapping from the bundled theme', () => {
    expect({
      definitions: Object.keys(definitions).length,
      extensions: Object.keys(extensionMappings).length,
      fileNames: Object.keys(fileNameMappings).length,
      languages: Object.keys(languageMappings).length,
      patterns: generated.filePatterns.length
    }).toEqual({
      definitions: 499,
      extensions: 520,
      fileNames: 167,
      languages: 86,
      patterns: 19
    })
  })

  it('only references declared icon definitions', () => {
    expect([...referencedIds].filter((id) => !(id in definitions))).toEqual([])
    expect(
      [...referencedIds].filter((id) => {
        const definition = definitions[id as keyof typeof definitions]
        return !('fontCharacter' in definition) && !('iconPath' in definition)
      })
    ).toEqual([])
  })

  it('exposes language mappings to audit before removing language lookup', () => {
    expect(Object.keys(languageMappings).sort()).toMatchInlineSnapshot(`
      [
        "CommandLabel",
        "SettingSet",
        "SettingView",
        "argdown",
        "bat",
        "bicep",
        "blade",
        "c",
        "chatagent",
        "clojure",
        "coffeescript",
        "cpp",
        "csharp",
        "css",
        "cuda-cpp",
        "dart",
        "django-html",
        "dockercompose",
        "dockerfile",
        "dotenv",
        "elixir",
        "elm",
        "erb",
        "fsharp",
        "git-commit",
        "github-issues",
        "go",
        "godot",
        "gradle",
        "groovy",
        "haml",
        "handlebars",
        "haskell",
        "haxe",
        "html",
        "ignore",
        "instructions",
        "jade",
        "java",
        "javascript",
        "javascriptreact",
        "jinja",
        "json",
        "jsonc",
        "jsonl",
        "julia",
        "kotlin",
        "latex",
        "less",
        "lua",
        "makefile",
        "markdown",
        "mustache",
        "nunjucks",
        "objective-c",
        "objective-cpp",
        "ocaml",
        "perl",
        "php",
        "postcss",
        "powershell",
        "prompt",
        "properties",
        "python",
        "r",
        "razor",
        "rescript",
        "ruby",
        "rust",
        "sass",
        "scss",
        "search-result",
        "shellscript",
        "skill",
        "sql",
        "stylus",
        "swift",
        "terraform",
        "tex",
        "todo",
        "typescript",
        "typescriptreact",
        "vala",
        "vue",
        "xml",
        "yaml",
      ]
    `)
  })

  it('makes every file language icon directly reachable', () => {
    const directDark = new Set([
      ...Object.values(generated.fileNames),
      ...Object.values(generated.fileExtensions),
      ...Object.values(iconTheme.fileNames),
      ...Object.values(iconTheme.fileExtensions)
    ])
    const directLight = new Set([
      ...Object.values(generated.fileNames),
      ...Object.values(generated.fileExtensions),
      ...Object.values(generated.light.fileNames),
      ...Object.values(generated.light.fileExtensions),
      ...Object.values(iconTheme.fileNames),
      ...Object.values(iconTheme.fileExtensions),
      ...Object.values(iconTheme.light.fileNames),
      ...Object.values(iconTheme.light.fileExtensions)
    ])
    const unreachable = (languageIds: Record<string, string>, direct: Set<string>): string[] =>
      Object.entries(languageIds)
        .filter(([, iconId]) => !direct.has(iconId))
        .map(([languageId]) => languageId)
        .sort()

    expect(unreachable(iconTheme.languageIds, directDark)).toEqual([
      'CommandLabel',
      'SettingSet',
      'SettingView'
    ])
    expect(
      unreachable({ ...iconTheme.languageIds, ...iconTheme.light.languageIds }, directLight)
    ).toEqual(['CommandLabel', 'SettingSet', 'SettingView'])
  })
})
