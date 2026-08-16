import { describe, expect, it } from 'vitest'
import { getFileIcon } from '@renderer/components/file-icon/file-icon-theme'

describe('file icon pattern associations', () => {
  it('matches patterns before generic extensions', () => {
    expect(getFileIcon('/project/Dockerfile.dev', 'file', false, false)).not.toEqual(
      getFileIcon('file.txt', 'file', false, false)
    )
    expect(getFileIcon('/project/.github/agents/reviewer.md', 'file', false, false)).not.toEqual(
      getFileIcon('file.md', 'file', false, false)
    )
    expect(getFileIcon('/project/my-docker-compose.dev.yaml', 'file', false, false)).not.toEqual(
      getFileIcon('file.yaml', 'file', false, false)
    )
  })

  it('matches exact filenames against a full path', () => {
    expect(getFileIcon('D:\\project\\package.json', 'file', false, false)).toEqual(
      getFileIcon('package.json', 'file', false, false)
    )
  })
})
