// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path-unified'

const harness = vi.hoisted(() => ({
  config: vi.fn(),
  defineTheme: vi.fn(),
  registerLanguage: vi.fn(),
  setTokensProvider: vi.fn(),
  tokenProvider: {},
  workers: {
    editor: class EditorWorker {}
  }
}))

vi.mock('monaco-editor/editor/editor.api', () => ({
  editor: { defineTheme: harness.defineTheme },
  languages: {
    register: harness.registerLanguage,
    setTokensProvider: harness.setTokensProvider,
    getLanguages: () => [
      { extensions: ['.ts', '.tsx'], id: 'typescript' },
      { extensions: ['.md'], id: 'markdown' },
      { extensions: ['.json'], id: 'json' },
      { filenames: ['Dockerfile'], id: 'dockerfile' },
      { firstLine: '^#!.*\\bnode', id: 'javascript' }
    ]
  }
}))
vi.mock('@monaco-editor/react', () => ({ loader: { config: harness.config } }))
vi.mock('monaco-editor/basic-languages/monaco.contribution', () => ({}))
vi.mock('monaco-editor/languages/features/json/tokenization.js', () => ({
  createTokenizationSupport: () => harness.tokenProvider
}))
vi.mock('monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching', () => ({}))
vi.mock('monaco-editor/editor/contrib/find/browser/findController', () => ({}))
vi.mock('monaco-editor/editor/contrib/folding/browser/folding', () => ({}))
vi.mock('monaco-editor/features/codicon/register', () => ({}))
vi.mock('monaco-editor/editor/editor.worker?worker', () => ({ default: harness.workers.editor }))

describe('Monaco preview setup', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    await import('../../../../src/extensions/workspace/renderer/preview/monaco')
  })

  it('configures the React loader with the bundled Monaco instance', () => {
    expect(harness.config).toHaveBeenCalledOnce()
    expect(harness.config).toHaveBeenCalledWith({ monaco: expect.any(Object) })
  })

  it('registers Workspace themes with the legacy diff colors', () => {
    expect(harness.defineTheme).toHaveBeenCalledWith(
      'larify-workspace-dark',
      expect.objectContaining({
        colors: expect.objectContaining({
          'diffEditor.insertedLineBackground': '#00A56E47',
          'diffEditor.removedLineBackground': '#D02A2347'
        })
      })
    )
    expect(harness.defineTheme).toHaveBeenCalledWith(
      'larify-workspace-light',
      expect.objectContaining({
        colors: expect.objectContaining({
          'diffEditor.insertedLineBackground': '#40B08B1F',
          'diffEditor.removedLineBackground': '#E8463A1F'
        })
      })
    )
  })

  it('selects the registered light and dark themes', async () => {
    const { workspaceMonacoTheme } =
      await import('../../../../src/extensions/workspace/renderer/preview/monaco')

    expect(workspaceMonacoTheme(true)).toBe('larify-workspace-dark')
    expect(workspaceMonacoTheme(false)).toBe('larify-workspace-light')
  })

  it('exports the shared four-character gutter geometry', async () => {
    const { workspaceMonacoGutterOptions } =
      await import('../../../../src/extensions/workspace/renderer/preview/monaco')

    expect(workspaceMonacoGutterOptions).toEqual({
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 10,
      lineNumbers: 'on',
      lineNumbersMinChars: 4
    })
  })

  it('resolves model languages from Monaco registrations', async () => {
    const { workspaceMonacoLanguage } =
      await import('../../../../src/extensions/workspace/renderer/preview/monaco')

    expect(workspaceMonacoLanguage('file.ts')).toBe('typescript')
    expect(workspaceMonacoLanguage('README.MD')).toBe('markdown')
    expect(workspaceMonacoLanguage('package.json')).toBe('json')
    expect(workspaceMonacoLanguage(join('workspace', 'Dockerfile'))).toBe('dockerfile')
    expect(workspaceMonacoLanguage(join('workspace', 'DOCKERFILE'))).toBe('dockerfile')
    expect(workspaceMonacoLanguage('script', '#!/usr/bin/env node\nconsole.log(1)')).toBe(
      'javascript'
    )
    expect(workspaceMonacoLanguage('script.ts', '#!/usr/bin/env node')).toBe('typescript')
    expect(workspaceMonacoLanguage('LICENSE')).toBe('plaintext')
  })

  it('registers JSON tokenization synchronously', () => {
    expect(harness.registerLanguage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'json', extensions: expect.arrayContaining(['.json']) })
    )
    expect(harness.setTokensProvider).toHaveBeenCalledWith('json', harness.tokenProvider)
  })

  it.each(['json', 'css', 'html', 'typescript', 'editorWorkerService'])(
    'uses only the core editor worker for %s',
    (label) => {
      expect(globalThis.MonacoEnvironment?.getWorker('', label)).toBeInstanceOf(
        harness.workers.editor
      )
    }
  )
})
