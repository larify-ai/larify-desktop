import { lazy, Suspense } from 'react'
import type { ComponentProps } from '@ant-design/x-markdown'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

const CodeHighlighter = lazy(() =>
  import('@ant-design/x/es/code-highlighter').then(({ default: component }) => ({
    default: component
  }))
)
const Mermaid = lazy(() =>
  import('@ant-design/x/es/mermaid').then(({ default: component }) => ({ default: component }))
)

export function MarkdownCode({
  block,
  children,
  dark,
  lang
}: ComponentProps & { dark: boolean }): React.JSX.Element {
  const code = String(children ?? '')
  if (!block) return <code>{children}</code>
  const language = lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const fallback = (
    <pre>
      <code>{code}</code>
    </pre>
  )

  if (language === 'mermaid') {
    return (
      <Suspense fallback={fallback}>
        <Mermaid config={{ theme: dark ? 'dark' : 'default' }} header={null}>
          {code}
        </Mermaid>
      </Suspense>
    )
  }
  return (
    <Suspense fallback={fallback}>
      <CodeHighlighter
        highlightProps={{ style: dark ? oneDark : undefined }}
        lang={language || undefined}
      >
        {code}
      </CodeHighlighter>
    </Suspense>
  )
}
