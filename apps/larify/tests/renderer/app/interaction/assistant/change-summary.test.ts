import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { summarizeMessageChanges } from '../../../../../src/renderer/src/app/interaction/assistant/change-summary'

describe('change summary', () => {
  it('summarizes the persisted Git snapshot', () => {
    const summary = summarizeMessageChanges(
      messageWith(
        snapshotPart([
          { additions: 12, deletions: 4, path: 'src/app.ts', patch: 'app patch' },
          { additions: 2, binary: true, deletions: 1, path: 'src/view.png', patch: 'view patch' }
        ])
      )
    )

    expect(summary).toEqual({
      additions: 14,
      deletions: 5,
      files: [
        { additions: 12, deletions: 4, path: 'src/app.ts', patch: 'app patch' },
        {
          additions: 2,
          binary: true,
          deletions: 1,
          path: 'src/view.png',
          patch: 'view patch'
        }
      ],
      root: 'D:\\repo'
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

  it.each([snapshotPart([]), { type: 'data-git-snapshot', data: null }])(
    'does not fall back to an old snapshot when the latest snapshot is cleared',
    (latest) => {
      expect(
        summarizeMessageChanges(
          messageWith(
            snapshotPart([{ additions: 1, deletions: 0, path: 'src/old.ts', patch: 'old' }]),
            latest
          )
        )
      ).toBeNull()
    }
  )

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

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid change count: %s',
    (additions) => {
      expect(
        summarizeMessageChanges(
          messageWith(snapshotPart([{ additions, deletions: 0, path: 'src/app.ts', patch: '' }]))
        )
      ).toBeNull()
    }
  )

  it('rejects a summary whose total exceeds the safe integer range', () => {
    expect(
      summarizeMessageChanges(
        messageWith(
          snapshotPart([
            { additions: Number.MAX_SAFE_INTEGER, deletions: 0, path: 'src/a.ts', patch: '' },
            { additions: 1, deletions: 0, path: 'src/b.ts', patch: '' }
          ])
        )
      )
    ).toBeNull()
  })

  it.each(['', 'src/invalid\0file.ts'])('rejects an impossible persisted file path: %s', (path) => {
    expect(
      summarizeMessageChanges(
        messageWith(snapshotPart([{ additions: 1, deletions: 0, path, patch: '' }]))
      )
    ).toBeNull()
  })

  it('rejects an impossible persisted snapshot root', () => {
    expect(
      summarizeMessageChanges(
        messageWith(
          snapshotPart(
            [{ additions: 1, deletions: 0, path: 'src/app.ts', patch: '' }],
            'D:\\invalid\0root'
          )
        )
      )
    ).toBeNull()
  })

  it('rejects duplicate files instead of double-counting a change', () => {
    const file = { additions: 1, deletions: 0, path: 'src/app.ts', patch: '+change' }
    expect(summarizeMessageChanges(messageWith(snapshotPart([file, file])))).toBeNull()
  })

  it('returns null when the message has no snapshot or the snapshot is empty', () => {
    expect(summarizeMessageChanges(messageWith({ type: 'text', text: 'done' }))).toBeNull()
    expect(summarizeMessageChanges(messageWith(snapshotPart([])))).toBeNull()
  })
})

type SnapshotFile = {
  additions: number
  binary?: boolean
  deletions: number
  path: string
  patch: string
}

function snapshotPart(files: SnapshotFile[], root = 'D:\\repo'): { type: string; data: unknown } {
  return { type: 'data-git-snapshot', data: { files, root } }
}

function messageWith(...parts: unknown[]): UIMessage {
  return { id: 'assistant-1', role: 'assistant', parts } as UIMessage
}
