import { describe, expect, it } from 'vitest'
import { PreviewRegistry } from '../../../../src/renderer/src/app/registry/file-previews'

describe('PreviewRegistry', () => {
  it('uses the first renderer that supports the file', () => {
    const registry = new PreviewRegistry()
    const fallback = { component: (() => null) as never, supports: () => true }
    const pdf = {
      component: (() => null) as never,
      supports: (file: { mime: string }) => file.mime === 'application/pdf'
    }
    registry.register(pdf)
    registry.register(fallback)

    expect(registry.find({ binary: true, mime: 'application/pdf', path: 'page.pdf' })).toBe(pdf)
    expect(registry.find({ binary: false, mime: 'text/plain', path: 'file.txt' })).toBe(fallback)
  })
})
