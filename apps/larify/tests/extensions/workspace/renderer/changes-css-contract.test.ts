import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// workspace.css 用 ="true" 精确匹配 data-modified-empty / data-original-empty；
// 组件若把它们写成布尔（React 会省略 false 的属性），对应的选择器就静默失效。
// 这里做静态契约检查，防止再次出现「删除文件看不到红色 / 幻影行清不掉」这类问题。
const css = readFileSync(
  resolve(__dirname, '../../../../src/extensions/workspace/renderer/workspace.css'),
  'utf8'
)
const component = readFileSync(
  resolve(__dirname, '../../../../src/extensions/workspace/renderer/changes/monaco-diff.tsx'),
  'utf8'
)

const cssSelectorsFor = (attribute: string): string[] =>
  css
    .split('\n')
    .filter((line) => line.includes(`[${attribute}='true']`))
    .map((line) => line.trim())

// 只取 JSX 里真正渲染属性的行（`data-x={...}`），排除注释与断言。
const attributeUsages = (attribute: string): string[] =>
  component
    .split('\n')
    .filter((line) => new RegExp(`\\b${attribute}=\\{`).test(line))
    .filter((line) => !line.trim().startsWith('//'))

describe('workspace.css / monaco-diff 属性契约', () => {
  it('keeps the whole-file highlight selectors for both directions', () => {
    expect(css).toContain('.workspace-added-only-editor .workspace-added-line')
    expect(css).toContain('.workspace-removed-only-editor .workspace-removed-line')
    // 删除必须取“删除色”，不能落到默认的插入色。
    // 具体用 removedLineBackground 还是 removedTextBackground 是与既有视觉一致的
    // 取色选择，不作硬性规定；只要不是 inserted* 即可。
    const removedRule = css.slice(css.indexOf('.workspace-removed-only-editor'))
    expect(removedRule).toMatch(/diffEditor-removed(Line|Text)Background/)
    expect(removedRule).not.toContain('inserted')
  })

  it('renders every data attribute the CSS matches as an explicit string', () => {
    for (const attribute of ['data-modified-empty', 'data-original-empty']) {
      expect(cssSelectorsFor(attribute).length).toBeGreaterThan(0)
      const usage = attributeUsages(attribute)
      // 现在只有 diff 分支渲染这两个属性（整文件分支已不再需要它们）。
      expect(usage.length).toBeGreaterThan(0)
      for (const line of usage) {
        expect(
          /'true'|"true"/.test(line),
          `${attribute} must be rendered as an explicit "true"/"false" string, got: ${line.trim()}`
        ).toBe(true)
      }
    }
  })

  it('does not render whole-file-only data attributes anywhere', () => {
    // 整文件分支不再渲染 data-added-only / data-deleted-only：没有任何 CSS 消费者。
    for (const attribute of ['data-added-only', 'data-deleted-only']) {
      expect(cssSelectorsFor(attribute)).toHaveLength(0)
      expect(attributeUsages(attribute)).toHaveLength(0)
    }
  })

  it('keeps the phantom-row clearing rule limited to partially-empty diffs', () => {
    // 整文件增/删已改走 plain editor，不再经过 .monaco-diff-editor，
    // 因此这条清空规则只应作用在 diff 编辑器内部。
    const clearing = css.slice(css.indexOf(".workspace-file-preview[data-original-empty='true']"))
    expect(clearing).toContain('.monaco-diff-editor')
    // 用于整文件删除的“重染”死规则必须已删除。
    expect(css).not.toContain(".workspace-file-preview[data-deleted-only='true']")
  })

  it('does not resurrect the removed line-insert recolor selectors', () => {
    // 真正要防的是“用 [data-deleted-only] 去改 .monaco-diff-editor 里的 line-insert”
    // 这条死规则复活（它只在 split 下命中，unified 下从不生效）。
    // 注意不要顺带禁掉 removedTextBackground 变量本身——整文件删除行的取色可以用它。
    expect(css).not.toMatch(/data-deleted-only=['"]true['"][\s\S]{0,120}?line-insert/)
  })
})
