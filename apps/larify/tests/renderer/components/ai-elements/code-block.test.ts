// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
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

import {
  CodeBlock,
  highlightCode
} from '../../../../src/renderer/src/components/ai-elements/code-block'

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

describe('CodeBlock render', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    codeToTokens.mockClear()
    createHighlighter.mockClear()
    createHighlighter.mockImplementation(async () => highlighter)
  })

  it('renders raw text without invoking the shiki highlighter when highlight is disabled', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const code = 'const a = 1;\nconst b = 2;'

    await act(async () => {
      root.render(
        createElement(CodeBlock, {
          code,
          language: 'js',
          highlight: false
        })
      )
    })

    // 内容完整渲染为纯文本
    expect(container.textContent).toContain('const a = 1;')
    expect(container.textContent).toContain('const b = 2;')
    // 不触发 shiki 高亮（createHighlighter / codeToTokens 均不应被调用）
    expect(createHighlighter).not.toHaveBeenCalled()
    expect(codeToTokens).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    container.remove()
  })

  it('still invokes the shiki highlighter by default when highlight is enabled', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const code = 'const a = 1;\nconst b = 2;'

    await act(async () => {
      // 用 mock 已知的语言（typescript），避免因语言未加载而 fallback 到 text
      root.render(createElement(CodeBlock, { code, language: 'typescript' }))
    })
    await flushPromises()

    // 默认（highlight 未显式传）应走 shiki 高亮：codeToTokens 被调用来分词。
    // createHighlighter 可能因模块级 highlighterCache 已被前置测试命中而不必
    // 再次调用，故断言真正发生高亮分词的 codeToTokens。
    expect(codeToTokens).toHaveBeenCalledWith(
      code,
      expect.objectContaining({ lang: 'typescript' })
    )
    // 内容仍完整渲染
    expect(container.textContent).toContain('const a = 1;')
    expect(container.textContent).toContain('const b = 2;')

    await act(async () => root.unmount())
    container.remove()
  })
})
