import { useLayoutEffect, useMemo, useRef } from 'react'
import { XMarkdown, type ComponentProps, type XMarkdownProps } from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import '@ant-design/x-markdown/themes/light.css'
import '@ant-design/x-markdown/themes/dark.css'
import { ConfigProvider, theme as antdTheme } from 'antd'
import { gfmHeadingId } from 'marked-gfm-heading-id'
import type { PreviewRendererProps } from '@renderer/app/registry/file-previews'
import { useTheme } from '@renderer/app/theme/use-theme'
import { stripYamlFrontmatter } from './markdown-utils'
import { MarkdownCode } from './markdown-code'
import { MarkdownImage } from './markdown-image'
import { handleMarkdownLinkClick, scrollToHash } from './markdown-navigation'
import { useWorkspaceTextFile } from './use-workspace-text-file'

const markdownConfig: XMarkdownProps['config'] = {
  // x-markdown and marked-gfm-heading-id resolve different marked type versions.
  ...(gfmHeadingId() as unknown as XMarkdownProps['config']),
  extensions: Latex()
}

export function MarkdownPreview({
  file,
  resourceId,
  target
}: PreviewRendererProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const previewRef = useRef<HTMLDivElement>(null)
  const { content, error } = useWorkspaceTextFile(resourceId, file.path)
  const markdown = content === undefined ? undefined : stripYamlFrontmatter(content)
  const components = useMemo(
    () => ({
      code: (props: ComponentProps) => <MarkdownCode {...props} dark={resolvedTheme === 'dark'} />,
      img: (props: ComponentProps) => (
        <MarkdownImage {...props} currentFile={file.path} resourceId={resourceId} />
      )
    }),
    [file.path, resolvedTheme, resourceId]
  )

  useLayoutEffect(() => {
    if (target && previewRef.current) scrollToHash(previewRef.current, target.hash)
  }, [markdown, target])

  if (error) return <MarkdownPreviewError message={error} />
  if (markdown === undefined) return <div className="h-full" />

  return (
    <div
      className="workspace-markdown-preview h-full overflow-auto"
      onClick={(event) => handleMarkdownLinkClick(event, file.path, resourceId)}
      ref={previewRef}
    >
      <ConfigProvider
        theme={{
          algorithm:
            resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: markdownThemeTokens
        }}
      >
        <XMarkdown
          className={resolvedTheme === 'dark' ? 'x-markdown-dark' : 'x-markdown-light'}
          components={components}
          config={markdownConfig}
          content={markdown}
        />
      </ConfigProvider>
    </div>
  )
}

const markdownThemeTokens = {
  colorBgContainer: 'var(--workbench-content)',
  colorBorder: 'var(--border-strong)',
  colorBorderSecondary: 'var(--border)',
  colorFill: 'var(--muted)',
  colorFillContent: 'var(--muted)',
  colorPrimary: 'var(--primary)',
  colorText: 'var(--foreground)',
  colorTextHeading: 'var(--foreground)',
  colorTextSecondary: 'var(--muted-foreground)',
  fontFamily: 'var(--font-sans)',
  fontFamilyCode: 'var(--font-mono)'
}

function MarkdownPreviewError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{message}</div>
  )
}
