import * as monaco from 'monaco-editor/editor/editor.api'
import { loader } from '@monaco-editor/react'
import { basename, extname } from 'path-unified'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/basic-languages/monaco.contribution'
import { jsonDefaults } from 'monaco-editor/language/json/monaco.contribution'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/editor/contrib/find/browser/findController'
import 'monaco-editor/editor/contrib/folding/browser/folding'
import 'monaco-editor/features/codicon/register'

globalThis.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
}

jsonDefaults.setModeConfiguration({
  colors: false,
  completionItems: false,
  diagnostics: false,
  documentFormattingEdits: false,
  documentRangeFormattingEdits: false,
  documentSymbols: false,
  foldingRanges: false,
  hovers: false,
  selectionRanges: false,
  tokens: true
})

loader.config({ monaco })

const workspaceMonacoThemes = {
  dark: 'larify-workspace-dark',
  light: 'larify-workspace-light'
} as const

export const workspaceMonacoTheme = (dark: boolean): string =>
  workspaceMonacoThemes[dark ? 'dark' : 'light']

export const workspaceMonacoLanguage = (path: string, content = ''): string => {
  const filename = basename(path).toLowerCase()
  const extension = extname(filename).toLowerCase()
  const languages = monaco.languages.getLanguages()
  const language = languages.find(
    (candidate) =>
      candidate.extensions?.includes(extension) ||
      candidate.filenames?.some((name) => name.toLowerCase() === filename)
  )
  if (language) return language.id

  const firstLine = content.split(/\r?\n/, 1)[0]
  return (
    languages.find(
      (candidate) => candidate.firstLine && new RegExp(candidate.firstLine).test(firstLine)
    )?.id ?? 'plaintext'
  )
}

monaco.editor.defineTheme(workspaceMonacoThemes.dark, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'diffEditor.insertedLineBackground': '#00A56E47',
    'diffEditor.insertedTextBackground': '#00A56E47',
    'diffEditor.removedLineBackground': '#D02A2347',
    'diffEditor.removedTextBackground': '#D02A2347',
    'editor.background': '#1E1E1F',
    'editor.foreground': '#FFFFFFCC',
    'editor.lineHighlightBackground': '#FFFFFF0D',
    'editor.selectionBackground': '#FFFFFF14',
    'editorIndentGuide.activeBackground1': '#FFFFFF1A',
    'editorIndentGuide.background1': '#FFFFFF0D',
    'editorLineNumber.activeForeground': '#FFFFFFCC',
    'editorLineNumber.foreground': '#FFFFFF80'
  }
})

monaco.editor.defineTheme(workspaceMonacoThemes.light, {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'diffEditor.insertedLineBackground': '#40B08B1F',
    'diffEditor.insertedTextBackground': '#40B08B2E',
    'diffEditor.removedLineBackground': '#E8463A1F',
    'diffEditor.removedTextBackground': '#E8463A29',
    'editor.background': '#FAFAFA',
    'editor.foreground': '#000000E5',
    'editor.lineHighlightBackground': '#0000000D',
    'editor.selectionBackground': '#00000014',
    'editorIndentGuide.activeBackground1': '#0000001A',
    'editorIndentGuide.background1': '#0000000D',
    'editorLineNumber.activeForeground': '#111214',
    'editorLineNumber.foreground': '#72767B'
  }
})
