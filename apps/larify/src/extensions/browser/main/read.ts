import { Defuddle } from 'defuddle/node'

export interface ReadResult {
  title: string
  markdown: string
}

export async function htmlToMarkdown(html: string, url?: string): Promise<ReadResult> {
  try {
    const result = await Defuddle(html, url, { separateMarkdown: true, useAsync: false })
    return { title: result.title ?? '', markdown: (result.contentMarkdown ?? '').trim() }
  } catch {
    return { title: '', markdown: '' }
  }
}
