import { describe, expect, it } from 'vitest'
import {
  createWorkspaceDragData,
  readWorkspaceDragData
} from '../../../src/renderer/src/lib/attachment-drag'

describe('workspace attachment drag data', () => {
  it('round-trips files and directories without parsing their paths', () => {
    const data = { directory: true, name: '目录', path: '/工作区/目录' }

    expect(readWorkspaceDragData(createWorkspaceDragData(data))).toEqual(data)
  })

  it.each([
    '',
    'null',
    '42',
    '"text"',
    '[]',
    '{}',
    '{',
    JSON.stringify({ directory: false, name: '', path: '/workspace/file.ts' }),
    JSON.stringify({ directory: false, name: 'file.ts', path: '' }),
    JSON.stringify({ directory: 'false', name: 'file.ts', path: '/workspace/file.ts' })
  ])('rejects invalid data: %s', (value) => {
    expect(readWorkspaceDragData(value)).toBeUndefined()
  })
})
