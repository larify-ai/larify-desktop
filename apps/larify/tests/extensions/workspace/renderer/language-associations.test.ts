import { describe, expect, it } from 'vitest'
import { languageIdForFile } from '../../../../src/extensions/workspace/renderer/language-associations'

describe('languageIdForFile', () => {
  it('uses language contribution extensions', () => {
    expect(languageIdForFile('D:\\project\\src\\index.tsx')).toBe('typescriptreact')
  })

  it('matches contributed filenames against the basename', () => {
    expect(languageIdForFile('/project/composer.lock')).toBe('json')
  })
})
