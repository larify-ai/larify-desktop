import type { Element, Root } from 'hast'
import type { MessageResponseProps } from '@renderer/components/ai-elements/message'
import { defaultRehypePlugins } from 'streamdown'
import { visit } from 'unist-util-visit'

/**
 * 阻断非 image 的 data URI（避免 XSS 载荷），其余 src/href 原样保留供后续处理。
 * 消息正文与 workspace 预览共用，保证两条链路的 url 过滤行为一致。
 */
export function transformWorkspaceUrl(url: string, key: string): string | null {
  const normalized = url.toLowerCase()
  return key === 'src' && normalized.startsWith('data:') && !normalized.startsWith('data:image/')
    ? null
    : url
}

const driveHrefPattern = /^[a-z]:[\\/]/i

/**
 * 盘符链接（D:/docs/a.md、D:\docs\a.md）不是合法 URI scheme，rehype-sanitize 的
 * href 协议白名单（http/https/…）无法放行。在 sanitize **之前**把它改写为
 * file: URL（file:///D:/docs/a.md），白名单只需追加 'file' 即可同时满足：
 * - 本地链接可点击（原实现通过删除 protocols.href 达到，等价于关闭全部 href
 *   协议检查，javascript:/vbscript: 会漏过 sanitize 只靠组件层拦截——不安全）；
 * - javascript:、data:（href）等危险协议仍被白名单拒绝。
 */
export function rewriteDriveHrefs() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = node.properties?.href
      if (typeof href !== 'string' || !driveHrefPattern.test(href)) return
      node.properties.href = `file:///${encodeURI(href.replaceAll('\\', '/'))}`
    })
  }
}

/**
 * 默认 rehype-sanitize 会把盘符（D:/）/file: 协议的 href 剥离，导致本地文件链接无法点击。
 * href 协议白名单追加 'file'（配合 rewriteDriveHrefs 前置改写盘符链接），
 * src 额外放行 data（image data URI；非 image 的 data URI 由 transformWorkspaceUrl 拦截）。
 * clobberPrefix 置空：默认 'user-content-' 前缀会使 rehype-slug 生成的 heading id
 * 变成 'user-content-heading'，与 scrollToHash 查找的 id 不匹配 → 文档内锚点滚动失效。
 */
export function createWorkspaceLinkRehypePlugins(): NonNullable<
  MessageResponseProps['rehypePlugins']
> {
  const sanitize = defaultRehypePlugins.sanitize
  if (!Array.isArray(sanitize)) return [defaultRehypePlugins.raw, sanitize]
  const [plugin, options] = sanitize
  const schema = options as { protocols?: Record<string, string[]> }
  const protocols = { ...schema.protocols }
  protocols.href = [...(protocols.href ?? []), 'file']
  protocols.src = [...(protocols.src ?? []), 'data']
  return [
    rewriteDriveHrefs,
    defaultRehypePlugins.raw,
    [plugin, { ...schema, protocols, clobberPrefix: '' }]
  ]
}

/** 单例：消息正文与 workspace 预览共用同一份链接 rehype 插件。 */
export const workspaceLinkRehypePlugins = createWorkspaceLinkRehypePlugins()
