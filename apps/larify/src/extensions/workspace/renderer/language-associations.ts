import cssExtension from '@codingame/monaco-vscode-css-default-extension/resources/package.json'
import htmlExtension from '@codingame/monaco-vscode-html-default-extension/resources/package.json'
import jsonExtension from '@codingame/monaco-vscode-json-default-extension/resources/package.json'
import markdownExtension from '@codingame/monaco-vscode-markdown-basics-default-extension/resources/package.json'
import typescriptExtension from '@codingame/monaco-vscode-typescript-basics-default-extension/resources/package.json'

type Language = {
  extensions?: string[]
  filenames?: string[]
  id: string
}

type LanguageExtension = {
  contributes?: {
    languages?: Language[]
  }
}

const languages = [
  cssExtension,
  htmlExtension,
  jsonExtension,
  markdownExtension,
  typescriptExtension
].flatMap((extension) => (extension as LanguageExtension).contributes?.languages ?? [])

export function languageIdForFile(name: string): string | undefined {
  const normalized = name.replaceAll('\\', '/').toLowerCase()
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const byName = languages.find((language) =>
    language.filenames?.some((filename) => filename.toLowerCase() === basename)
  )
  if (byName) return byName.id

  return languages.find((language) =>
    language.extensions?.some((extension) => normalized.endsWith(extension.toLowerCase()))
  )?.id
}
