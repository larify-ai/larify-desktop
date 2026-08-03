import { describe, expect, it } from 'vitest'
import { isText } from '../../../../src/extensions/browser/main/content-type'

describe('browser content type', () => {
  it.each([
    'text/plain',
    'text/markdown; charset=utf-8',
    'application/json',
    'application/problem+json',
    'application/xml',
    'application/rss+xml'
  ])('recognizes textual content type %s', (contentType) => {
    expect(isText(contentType)).toBe(true)
  })

  it.each([null, '', 'application/octet-stream', 'application/pdf', 'image/png'])(
    'rejects non-textual content type %s',
    (contentType) => {
      expect(isText(contentType)).toBe(false)
    }
  )
})
