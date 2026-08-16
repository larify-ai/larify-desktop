// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XMarkdown, type ComponentProps } from '@ant-design/x-markdown'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@ant-design/x/es/code-highlighter', () => ({
  default: ({ children, highlightProps, lang }: MockCodeProps) =>
    createElement(
      'div',
      {
        'data-dark': String(Boolean(highlightProps?.style)),
        'data-language': lang,
        'data-testid': 'highlighter'
      },
      children
    )
}))
vi.mock('@ant-design/x/es/mermaid', () => ({
  default: ({ children, config, header }: MockMermaidProps) =>
    createElement(
      'div',
      { 'data-header': String(header), 'data-testid': 'mermaid', 'data-theme': config.theme },
      children
    )
}))

interface MockCodeProps {
  children: ReactNode
  highlightProps?: { style?: unknown }
  lang?: string
}

interface MockMermaidProps {
  children: ReactNode
  config: { theme: string }
  header: null
}

import { MarkdownCode } from '../../../../src/extensions/workspace/renderer/preview/markdown-code'

describe('MarkdownCode', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps inline code inline', async () => {
    await render({ block: false, children: 'const value = 1', dark: true })
    expect(container.innerHTML).toBe('<code>const value = 1</code>')
  })

  it('normalizes the fenced-code info string for CodeHighlighter', async () => {
    await render({ block: true, children: 'const value = 1\n', dark: true, lang: 'TS title=x' })
    expect(container.querySelector('[data-testid="highlighter"]')?.textContent).toBe(
      'const value = 1\n'
    )
    expect(container.querySelector('[data-language="ts"]')).not.toBeNull()
    expect(container.querySelector('[data-dark="true"]')).not.toBeNull()
  })

  it('handles the complete info string supplied by XMarkdown', async () => {
    await act(async () => {
      root.render(
        createElement(XMarkdown, {
          components: {
            code: (props: ComponentProps) => createElement(MarkdownCode, { ...props, dark: true })
          },
          content: '```TS title="example.ts"\nconst value = 1\n```'
        })
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[data-language="ts"]')?.textContent).toBe('const value = 1\n')
  })

  it('renders unlabelled code blocks without a language or dark syntax theme', async () => {
    await render({ block: true, children: 'plain text', dark: false })
    expect(container.querySelector('[data-testid="highlighter"]')?.textContent).toBe('plain text')
    expect(container.querySelector('[data-language]')).toBeNull()
    expect(container.querySelector('[data-dark="false"]')).not.toBeNull()
  })

  it('renders Mermaid blocks with the active theme', async () => {
    await render({ block: true, children: 'graph TD; A-->B', dark: false, lang: 'mermaid' })
    expect(container.querySelector('[data-testid="mermaid"]')?.textContent).toBe('graph TD; A-->B')
    expect(container.querySelector('[data-theme="default"]')).not.toBeNull()
    expect(container.querySelector('[data-header="null"]')).not.toBeNull()
  })

  it('uses Mermaid dark mode when the application is dark', async () => {
    await render({ block: true, children: 'graph TD; A-->B', dark: true, lang: 'MERMAID' })
    expect(container.querySelector('[data-theme="dark"]')).not.toBeNull()
  })

  async function render(props: Record<string, unknown>): Promise<void> {
    await act(async () => {
      root.render(createElement(MarkdownCode, props))
      await Promise.resolve()
    })
  }
})
