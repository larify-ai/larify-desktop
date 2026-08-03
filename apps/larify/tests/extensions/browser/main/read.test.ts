import { describe, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom/cached'
import { htmlToMarkdown } from '../../../../src/extensions/browser/main/read'

describe('htmlToMarkdown', () => {
  it('finds ids containing CSS syntax in cached documents', () => {
    const { document } = parseHTML('<div id="B:1">Content</div>')

    expect(document.getElementById('B:1')?.textContent).toBe('Content')
  })

  it('resolves React streamed content with colon-delimited ids', async () => {
    const html = `
      <html>
        <head><title>Test</title></head>
        <body>
          <main><template id="B:1"></template><!--/$--></main>
          <div hidden id="S:1"><p>Resolved content</p></div>
          <script>$RC("B:1","S:1")</script>
        </body>
      </html>
    `

    await expect(htmlToMarkdown(html, 'https://example.com')).resolves.toEqual({
      title: 'Test',
      markdown: 'Resolved content'
    })
  })

  it('escapes ids in selectors generated for hidden content', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const content = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ')

    try {
      const result = await htmlToMarkdown(
        `<html><head><title>Test</title></head><body><div hidden id="S:1">${content}</div></body></html>`,
        'https://example.com'
      )

      expect(result.markdown).toContain('word39')
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})
