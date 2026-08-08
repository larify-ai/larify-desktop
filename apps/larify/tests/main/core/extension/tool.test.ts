import { describe, expect, it } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'

import { wrapTool } from '../../../../src/main/core/extension/tool'

describe('extension tool', () => {
  it('requires a non-blank user-facing title', () => {
    const wrapped = wrapTool(tool({ inputSchema: z.object({ path: z.string() }) }))
    const schema = wrapped.inputSchema as z.ZodType

    expect(schema.safeParse({ path: 'a.txt', _title: '' }).success).toBe(false)
    expect(schema.safeParse({ path: 'a.txt', _title: '   ' }).success).toBe(false)
    expect(schema.safeParse({ path: 'a.txt', _title: ' Read file ' }).data).toEqual({
      path: 'a.txt',
      _title: 'Read file'
    })
  })
})
