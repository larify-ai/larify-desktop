import { describe, expect, it, vi } from 'vitest'
import { htmlToMarkdown } from '../../../../src/extensions/browser/main/read'

describe('htmlToMarkdown', () => {
  it('reads visible content whose id contains CSS syntax', async () => {
    const result = await htmlToMarkdown(
      '<html><body><main id="B:1">Content <span>"B:1"</span></main></body></html>'
    )

    expect(result.markdown).toContain('Content')
    expect(result.markdown).toContain('B:1')
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

  it.each(['S:1', '1-starts-with-digit', 'has space', 'has.dot'])(
    'handles the id %s in selectors generated for hidden content',
    async (id) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const content = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ')

      try {
        const result = await htmlToMarkdown(
          `<html><head><title>Test</title></head><body><div hidden id="${id}">${content}</div></body></html>`,
          'https://example.com'
        )

        expect(result.markdown).toContain('word39')
        expect(error).not.toHaveBeenCalled()
      } finally {
        error.mockRestore()
      }
    }
  )
})
