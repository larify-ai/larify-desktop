import { describe, expect, it } from 'vitest'
import { formatProcessingDuration } from '../../../../../src/renderer/src/app/interaction/assistant/processing-duration'

describe('processing duration', () => {
  it.each([
    [999, '处理了 0秒'],
    [1_000, '处理了 1秒'],
    [60_000, '处理了 1分钟 0秒'],
    [3_600_000, '处理了 1小时 0分钟 0秒'],
    [3_661_000, '处理了 1小时 1分钟 1秒'],
    [86_400_000, '处理了 1天 0小时 0分钟 0秒'],
    [93_784_000, '处理了 1天 2小时 3分钟 4秒']
  ])('formats %i milliseconds', (duration, expected) => {
    expect(formatProcessingDuration(10_000, 10_000 + duration)).toBe(expected)
  })

  it('clamps a negative duration to zero', () => {
    expect(formatProcessingDuration(2_000, 1_000)).toBe('处理了 0秒')
  })
})
