import { describe, expect, it } from 'vitest'
import { stripYamlFrontmatter } from '../../../../src/extensions/workspace/renderer/preview/markdown-utils'

// 覆盖三套换行结尾：LF / CRLF / 单独 CR（老 Mac）
const encodings = {
  LF: (s: string) => s,
  CRLF: (s: string) => s.replace(/\n/g, '\r\n'),
  CR: (s: string) => s.replace(/\n/g, '\r'),
}

describe('stripYamlFrontmatter — 回归测试', () => {
  describe('文档最顶部的合法 frontmatter 应被正确剥离', () => {
    for (const [name, conv] of Object.entries(encodings)) {
      it(`--- 风格 (${name})`, () => {
        const md = conv('---\ntitle: Notes\ntags:\n  - work\n---\n# Body')
        expect(stripYamlFrontmatter(md)).toBe(conv('# Body'))
      })

      it(`= yaml = 风格 (${name})`, () => {
        const md = conv('= yaml =\nname: a\n= yaml =\nbody')
        expect(stripYamlFrontmatter(md)).toBe(conv('body'))
      })

      it(`... 闭合 (${name})`, () => {
        const md = conv('---\nname: a\n...\nbody')
        expect(stripYamlFrontmatter(md)).toBe(conv('body'))
      })

      it(`BOM + --- (${name})`, () => {
        const md = conv('\uFEFF---\ntitle: Notes\n---\nBody')
        expect(stripYamlFrontmatter(md)).toBe(conv('Body'))
      })
    }
  })

  describe('非法但闭合的 frontmatter 也应剥离（避免 name/description 泄露）', () => {
    for (const [name, conv] of Object.entries(encodings)) {
      it(`未闭合数组 (${name})`, () => {
        const md = conv('---\ntags: [\n---\n# Body')
        expect(stripYamlFrontmatter(md)).toBe(conv('# Body'))
      })

      it(`含未加引号冒号的值 (${name})`, () => {
        const md = conv('---\nerror: Failed to parse URL: ERR_INVALID_URL\n---\nBody')
        expect(stripYamlFrontmatter(md)).toBe(conv('Body'))
      })
    }
  })

  describe('文档中段 / 非顶部的 --- 块绝不能被误删', () => {
    for (const [name, conv] of Object.entries(encodings)) {
      it(`水平分隔线 (${name})`, () => {
        const md = conv('Intro\n---\nSection\n---\nOutro')
        expect(stripYamlFrontmatter(md)).toBe(md)
      })

      it(`紧跟正文后的水平分隔线 (${name})`, () => {
        const md = conv('Before\n---\nAfter')
        expect(stripYamlFrontmatter(md)).toBe(md)
      })

      it(`第 2 行才出现的 frontmatter（应保留）(${name})`, () => {
        const md = conv('abc\n---\nx: 1\n---\nbody')
        expect(stripYamlFrontmatter(md)).toBe(md)
      })

      it(`顶部 frontmatter + 后文还有 ---（后文应保留）(${name})`, () => {
        const md = conv('---\nt: 1\n---\nBody\n---\nMore\n---')
        expect(stripYamlFrontmatter(md)).toBe(conv('Body\n---\nMore\n---'))
      })

      it(`文档中段独立 --- 块 (${name})`, () => {
        const md = conv('start\n---\nmiddle\n---\nend')
        expect(stripYamlFrontmatter(md)).toBe(md)
      })

      it(`多个非顶部 --- 块 (${name})`, () => {
        const md = conv('---\na: 1\n---\nmid\n---\nb: 2\n---\nend')
        // 第一个 --- 不是行首（前面是别的内容则保留；这里行首就是 ---，
        // 但本场景测试的是：仅当整段以 --- 开头才剥，故此处应剥离顶部
        // 真实文档里这种连续块极少见，仅确认首个被剥、其余保留）
        expect(stripYamlFrontmatter(md)).toBe(conv('mid\n---\nb: 2\n---\nend'))
      })
    }
  })

  describe('边界与非法输入', () => {
    it('普通文本（不含 ---）原样返回', () => {
      expect(stripYamlFrontmatter('Just text\nwith --- inside\nnot at top')).toBe(
        'Just text\nwith --- inside\nnot at top',
      )
    })

    it('空字符串', () => {
      expect(stripYamlFrontmatter('')).toBe('')
    })

    it('仅开头分隔符、无闭合 → 不剥', () => {
      expect(stripYamlFrontmatter('---\ntitle: x')).toBe('---\ntitle: x')
    })

    it('空 frontmatter（---/--- 紧贴）→ 剥离', () => {
      expect(stripYamlFrontmatter('---\n---\nBody')).toBe('Body')
    })
  })
})
