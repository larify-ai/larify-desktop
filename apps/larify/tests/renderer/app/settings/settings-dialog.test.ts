import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('src/renderer/src/app/settings/settings-dialog.tsx'), 'utf8')

describe('SettingsDialog', () => {
  it('renders a minimal form: title, key field and save/cancel only', () => {
    expect(source).toContain('<DialogTitle>设置</DialogTitle>')
    // 字段名不带「官方」，输入框保留普通边框但聚焦时无灰色高亮。
    expect(source).toContain('>DeepSeek API Key</span>')
    expect(source).toContain('pr-9 focus-visible:border-input focus-visible:ring-0')
    expect(source).toContain('placeholder="sk-..."')
    expect(source).toContain("type={revealed ? 'text' : 'password'}")
    expect(source).toContain('<Button type="submit">保存</Button>')
    expect(source).toContain('取消')
    // 空保存 = 清除，不设独立的清除按钮（允许注释里出现"清除"字样）。
    expect(source).not.toMatch(/>\s*清除\s*<\/Button>/)
  })

  it('keeps save semantics in the storage layer and closes after submit', () => {
    // 打开时读取已存 Key 预填；保存只调一次存储层（含空=清除语义），然后关闭。
    expect(source).toContain('useState(() => readOwnApiKey())')
    expect(source).toContain('saveOwnApiKey(apiKey)')
    expect(source).toContain('onClose()')
    expect(source).not.toMatch(/writeOwnApiKey|clearOwnApiKey/)
  })

  it('provides a password visibility toggle wired to the input type', () => {
    expect(source).toContain("aria-label={revealed ? '隐藏 API Key' : '显示 API Key'}")
    expect(source).toContain('onClick={() => setRevealed((current) => !current)}')
    expect(source).toContain('EyeOffIcon')
    expect(source).toContain('EyeIcon')
  })

  it('is mounted on demand and stays open until closed by the parent', () => {
    // 由父组件按需挂载：open 恒为 true，Esc/遮罩/右上角关闭都汇到 onClose。
    expect(source).toContain('<Dialog\n      open\n      onOpenChange=')
    expect(source).toContain('if (!next) onClose()')
  })
})
