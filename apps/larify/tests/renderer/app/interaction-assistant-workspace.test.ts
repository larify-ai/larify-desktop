import { describe, expect, it } from 'vitest'
import {
  uniqueWorkspaces,
  workspaceName
} from '../../../src/renderer/src/app/interaction/assistant/workspace'

describe('workspace helpers', () => {
  it('names the default space and paths', () => {
    expect(workspaceName('')).toBe('默认空间')
    expect(workspaceName('D:\\Workspace\\Project')).toBe('Project')
    expect(workspaceName('/')).toBe('默认空间')
  })

  it('deduplicates exact paths while preserving order', () => {
    expect(uniqueWorkspaces(['', 'D:\\Workspace\\Project', '', '/home/Project'])).toEqual([
      '',
      'D:\\Workspace\\Project',
      '/home/Project'
    ])
  })
})
