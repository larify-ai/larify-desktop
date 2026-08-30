import type { MessageResponseProps } from '@renderer/components/ai-elements/message'
import { defaultRehypePlugins } from 'streamdown'

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

/**
 * 默认 rehype-sanitize 会把盘符（D:/）/file: 协议的 href 剥离，导致本地文件链接无法点击。
 * 删除 protocols.href 放行任意协议目标（相对路径与 #anchor 不受影响），src 额外放行 data。
 * javascript:/vbscript: 等危险属性不在此列，sanitize 默认仍按属性级规则处理。
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
  delete protocols.href
  protocols.src = [...(protocols.src ?? []), 'data']
  return [defaultRehypePlugins.raw, [plugin, { ...schema, protocols, clobberPrefix: '' }]]
}

/** 单例：消息正文与 workspace 预览共用同一份链接 rehype 插件。 */
export const workspaceLinkRehypePlugins = createWorkspaceLinkRehypePlugins()
