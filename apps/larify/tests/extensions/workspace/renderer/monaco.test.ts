// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  config: vi.fn(),
  workers: {
    editor: class EditorWorker {}
  }
}))

vi.mock('monaco-editor/editor/editor.api', () => ({ editor: {} }))
vi.mock('@monaco-editor/react', () => ({ loader: { config: harness.config } }))
vi.mock('monaco-editor/basic-languages/monaco.contribution', () => ({}))
vi.mock('monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching', () => ({}))
vi.mock('monaco-editor/editor/contrib/find/browser/findController', () => ({}))
vi.mock('monaco-editor/editor/contrib/folding/browser/folding', () => ({}))
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

  it.each(['json', 'css', 'html', 'typescript', 'editorWorkerService'])(
    'uses only the core editor worker for %s',
    (label) => {
      expect(globalThis.MonacoEnvironment?.getWorker('', label)).toBeInstanceOf(
        harness.workers.editor
      )
    }
  )
})
