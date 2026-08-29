import { describe, expect, it } from 'vitest'
import {
  formatProcessingDuration,
  formatProcessingDurationMs
} from '../../../../../src/renderer/src/app/interaction/assistant/processing-duration'

describe('processing duration', () => {
  it.each([
    [999, '处理了 1秒'],
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

  it('formats an accumulated millisecond total directly', () => {
    expect(formatProcessingDurationMs(0)).toBe('处理了 0秒')
    expect(formatProcessingDurationMs(1_000)).toBe('处理了 1秒')
    expect(formatProcessingDurationMs(60_000)).toBe('处理了 1分钟 0秒')
    expect(formatProcessingDurationMs(3_661_000)).toBe('处理了 1小时 1分钟 1秒')
    expect(formatProcessingDurationMs(93_784_000)).toBe('处理了 1天 2小时 3分钟 4秒')
  })

  it('clamps a negative accumulated total to zero', () => {
    expect(formatProcessingDurationMs(-1_000)).toBe('处理了 0秒')
  })
})
