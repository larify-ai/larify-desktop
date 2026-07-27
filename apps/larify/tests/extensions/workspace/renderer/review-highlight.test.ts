import { describe, expect, it } from 'vitest'
import { roundChangedLines } from '../../../../src/extensions/workspace/renderer/review-highlight'

describe('roundChangedLines', () => {
  it('returns modified-side lines added by the round', () => {
    expect(
      roundChangedLines('@@ -2,2 +2,3 @@\n same\n-old\n+new\n+extra')
    ).toEqual([
      { kind: 'added', line: 3 },
      { kind: 'added', line: 4 }
    ])
  })

  it('anchors a deletion-only hunk on the modified side', () => {
    expect(roundChangedLines('@@ -4,2 +4,1 @@\n same\n-removed')).toEqual([
      { kind: 'deleted', line: 4 }
    ])
  })
})
