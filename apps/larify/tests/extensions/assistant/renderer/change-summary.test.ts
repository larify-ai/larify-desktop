import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { summarizeMessageChanges } from '../../../../src/extensions/assistant/renderer/lib/change-summary'

describe('change summary', () => {
  it('summarizes the persisted Git snapshot', () => {
    const summary = summarizeMessageChanges(
      messageWith(
        snapshotPart([
          { additions: 12, deletions: 4, path: 'src/app.ts', patch: 'app patch' },
          { additions: 2, deletions: 1, path: 'src/view.ts', patch: 'view patch' }
        ])
      )
    )

    expect(summary).toEqual({
      additions: 14,
      deletions: 5,
      files: [
        { additions: 12, deletions: 4, path: 'src/app.ts', patch: 'app patch' },
        { additions: 2, deletions: 1, path: 'src/view.ts', patch: 'view patch' }
      ]
    })
  })

  it('uses the latest valid snapshot part', () => {
    const summary = summarizeMessageChanges(
      messageWith(
        snapshotPart([{ additions: 1, deletions: 0, path: 'src/old.ts', patch: 'old' }]),
        { type: 'text', text: 'done' },
        snapshotPart([{ additions: 2, deletions: 0, path: 'src/latest.ts', patch: 'latest' }])
      )
    )

    expect(summary?.files[0].path).toBe('src/latest.ts')
  })

  it('ignores an invalid snapshot instead of showing a partial or misleading summary', () => {
    const summary = summarizeMessageChanges(
      messageWith(
        snapshotPart([
          { additions: 1, deletions: 0, path: 'src/valid.ts', patch: 'valid' },
          { additions: Number.NaN, deletions: 0, path: 'src/broken.ts', patch: '' }
        ]),
        {
          type: 'tool-edit',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: {
            kind: 'diff',
            path: 'src/tool-only.ts',
            patch: 'tool diff must not be used'
          }
        }
      )
    )

    expect(summary).toBeNull()
  })

  it('returns null when the message has no snapshot or the snapshot is empty', () => {
    expect(summarizeMessageChanges(messageWith({ type: 'text', text: 'done' }))).toBeNull()
    expect(summarizeMessageChanges(messageWith(snapshotPart([])))).toBeNull()
  })
})

type SnapshotFile = {
  additions: number
  deletions: number
  path: string
  patch: string
}

function snapshotPart(files: SnapshotFile[]): { type: string; data: unknown } {
  return { type: 'data-git-snapshot', data: { files } }
}

function messageWith(...parts: unknown[]): UIMessage {
  return { id: 'assistant-1', role: 'assistant', parts } as UIMessage
}
