import { describe, expect, it } from 'vitest'
import {
  uniqueWorkspaces,
  workspaceKey,
  workspaceName
} from '../../../src/renderer/src/app/interaction/assistant/workspace'

describe('workspace helpers', () => {
  it('treats the configured workspace directory as the default space', () => {
    expect(workspaceKey('')).toBe('default')
    expect(workspaceKey('C:\\Users\\test\\.larify\\workspace')).toBe('default')
    expect(workspaceName('C:\\Users\\test\\.larify\\workspace')).toBe('默认空间')
  })

  it('deduplicates equivalent paths while preserving order', () => {
    expect(
      uniqueWorkspaces([
        '',
        'C:\\Users\\test\\.larify\\workspace',
        'D:\\Workspace\\Project',
        'd:/workspace/project/'
      ])
    ).toEqual(['', 'D:\\Workspace\\Project'])
  })
})
