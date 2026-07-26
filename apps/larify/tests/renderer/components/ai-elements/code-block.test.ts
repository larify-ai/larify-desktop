import { beforeEach, describe, expect, it, vi } from 'vitest'

const { codeToTokens, createHighlighter, highlighter } = vi.hoisted(() => {
  const codeToTokens = vi.fn((code: string) => ({
    bg: 'transparent',
    fg: 'inherit',
    tokens: [[{ color: 'inherit', content: code }]]
  }))
  const highlighter = {
    codeToTokens,
    getLoadedLanguages: () => ['typescript', 'css']
  }
  return {
    codeToTokens,
    createHighlighter: vi.fn(async () => highlighter),
    highlighter
  }
})

vi.mock('shiki', () => ({
  createHighlighter
}))

import { highlightCode } from '../../../../src/renderer/src/components/ai-elements/code-block'

const flushPromises = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('highlightCode', () => {
  beforeEach(() => {
    codeToTokens.mockClear()
    createHighlighter.mockClear()
    createHighlighter.mockImplementation(async () => highlighter)
  })

  it('deduplicates tokenization while the same code is in flight', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const code = 'const rendererDeduplication = true'

    highlightCode(code, 'typescript', first)
    highlightCode(code, 'typescript', second)
    await flushPromises()

    expect(codeToTokens).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('does not share cached tokens between long snippets with equal edges', async () => {
    const prefix = 'x'.repeat(100)
    const suffix = 'z'.repeat(100)
    const firstCode = `${prefix}a${suffix}`
    const secondCode = `${prefix}b${suffix}`

    highlightCode(firstCode, 'typescript')
    await flushPromises()
    highlightCode(secondCode, 'typescript')
    await flushPromises()

    expect(codeToTokens).toHaveBeenCalledTimes(2)
    expect(codeToTokens).toHaveBeenNthCalledWith(
      1,
      firstCode,
      expect.objectContaining({ lang: 'typescript' })
    )
    expect(codeToTokens).toHaveBeenNthCalledWith(
      2,
      secondCode,
      expect.objectContaining({ lang: 'typescript' })
    )
  })

  it('retries a language after highlighter initialization fails', async () => {
    const error = new Error('highlighter unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    createHighlighter.mockRejectedValueOnce(error)
    const code = 'body { color: inherit }'

    highlightCode(code, 'css')
    await flushPromises()
    highlightCode(code, 'css')
    await flushPromises()

    expect(createHighlighter).toHaveBeenCalledTimes(2)
    expect(codeToTokens).toHaveBeenCalledWith(
      code,
      expect.objectContaining({ lang: 'css' })
    )
    consoleError.mockRestore()
  })
})
