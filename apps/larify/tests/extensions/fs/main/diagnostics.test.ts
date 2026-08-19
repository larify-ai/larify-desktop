import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiagnosticSeverity } from 'vscode-languageserver-protocol'
import { describe, expect, it, vi } from 'vitest'
import { editFileTool } from '../../../../src/extensions/fs/main/edit'
import {
  formatFileDiagnostics,
  provideFileDiagnostics,
  registerFileDiagnosticsProvider,
  type FileDiagnosticsProvider
} from '../../../../src/extensions/fs/main/diagnostics'
import { markRead } from '../../../../src/extensions/fs/main/state'
import { writeFileTool } from '../../../../src/extensions/fs/main/write'
import { callTool } from './harness'

const provider: FileDiagnosticsProvider = {
  matches: (file) => file.endsWith('.md'),
  provide: async (file) => ({
    uri: file,
    diagnostics: [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 }
        },
        severity: DiagnosticSeverity.Warning,
        source: 'test',
        message: 'Split this document.'
      }
    ]
  })
}

async function withProviders<T>(
  providers: FileDiagnosticsProvider[],
  run: () => Promise<T>
): Promise<T> {
  const dispose = providers.map(registerFileDiagnosticsProvider)
  try {
    return await run()
  } finally {
    for (const unregister of dispose) unregister()
  }
}

describe('file diagnostics', () => {
  it('does not call providers that do not match', async () => {
    const provide = vi.fn()
    const unmatched: FileDiagnosticsProvider = {
      matches: () => false,
      provide
    }

    await withProviders([unmatched], async () => {
      expect(await provideFileDiagnostics('subject.txt')).toEqual([])
      expect(provide).not.toHaveBeenCalled()
    })
  })

  it('runs matching providers and ignores provider failures', async () => {
    const failing: FileDiagnosticsProvider = {
      matches: () => true,
      provide: async () => {
        throw new Error('failure')
      }
    }

    await withProviders([provider, failing], async () => {
      const results = await provideFileDiagnostics('subject.md')
      expect(results).toHaveLength(1)
      expect(results[0].diagnostics[0].message).toBe('Split this document.')
    })
  })

  it('ignores failures from provider matching', async () => {
    const failing: FileDiagnosticsProvider = {
      matches: () => {
        throw new Error('failure')
      },
      provide: vi.fn()
    }

    await withProviders([failing], async () => {
      expect(await provideFileDiagnostics('subject.md')).toEqual([])
      expect(failing.provide).not.toHaveBeenCalled()
    })
  })

  it('preserves provider order', async () => {
    const second: FileDiagnosticsProvider = {
      matches: () => true,
      provide: async () => ({ uri: 'second', diagnostics: [] })
    }

    await withProviders([provider, second], async () => {
      const results = await provideFileDiagnostics('subject.md')
      expect(results.map(({ uri }) => uri)).toEqual(['subject.md', 'second'])
    })
  })

  it('formats diagnostics for model output', () => {
    expect(
      formatFileDiagnostics([
        {
          uri: 'subject.md',
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 }
              },
              message: 'Split this document.'
            }
          ]
        }
      ])
    ).toBe('\n\nDiagnostics:\n- Error: Split this document.')
  })

  it('formats empty diagnostics as empty output', () => {
    expect(formatFileDiagnostics()).toBe('')
    expect(formatFileDiagnostics([{ uri: 'subject.md', diagnostics: [] }])).toBe('')
  })

  it('injects diagnostics after writing a file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-file-diagnostics-'))
    try {
      await withProviders([provider], async () => {
        const result = await callTool<{ summary: string; diagnostics: string }>(writeFileTool, {
          file_path: join(root, 'subject.md'),
          content: '# Subject'
        })

        expect(result.diagnostics).toBe('\n\nDiagnostics:\n- Warning: Split this document.')
        expect(writeFileTool.toModelOutput?.({ output: result } as never)).toEqual({
          type: 'text',
          value: `${result.summary}\n\nDiagnostics:\n- Warning: Split this document.`
        })
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('injects diagnostics after editing a file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'larify-file-diagnostics-'))
    try {
      const file = join(root, 'subject.md')
      writeFileSync(file, 'before')
      markRead('test', file, statSync(file).mtimeMs)

      await withProviders([provider], async () => {
        const result = await callTool<{ summary: string; diagnostics: string }>(editFileTool, {
          file_path: file,
          old_string: 'before',
          new_string: 'after',
          replace_all: false
        })

        expect(result.diagnostics).toBe('\n\nDiagnostics:\n- Warning: Split this document.')
        expect(editFileTool.toModelOutput?.({ output: result } as never)).toEqual({
          type: 'text',
          value: `${result.summary}\n\nDiagnostics:\n- Warning: Split this document.`
        })
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
