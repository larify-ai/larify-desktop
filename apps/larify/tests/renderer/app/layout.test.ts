import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Layout } from '../../../src/renderer/src/app/layout/layout'

const css = readFileSync(resolve('src/renderer/src/assets/main.css'), 'utf8')
const shell = readFileSync(resolve('src/extensions/shell/main/index.ts'), 'utf8')
const layout = readFileSync(resolve('src/renderer/src/app/layout/layout.tsx'), 'utf8')
const resizable = readFileSync(resolve('src/renderer/src/components/ui/resizable.tsx'), 'utf8')

describe('workbench layout specification', () => {
  it('uses the specified navigation width range', () => {
    expect(layout).toContain('defaultSize={275}')
    expect(layout).toContain('minSize={240}')
    expect(layout).toContain('maxSize={520}')
    expect(layout).toContain('groupResizeBehavior="preserve-pixel-size"')
  })

  it('uses a 64/36 split with both minimum widths', () => {
    expect(layout).toContain('defaultSize="64%"')
    expect(layout).toContain('minSize={352}')
    expect(layout).toContain('defaultSize="36%"')
    expect(layout).toContain('minSize={320}')
    expect(layout).toContain('id="content"')
    expect(layout).toContain('minSize={672}')
  })

  it('uses the specified top bar height and main content radius', () => {
    expect(css).toContain('--titlebar-h: env(titlebar-area-height, 2rem)')
    expect(shell).toContain('const titleBarHeight = 45')
    expect(shell.match(/height: titleBarHeight/g)).toHaveLength(2)
    expect(layout).toContain('rounded-l-[12px]')
  })

  it('renders all regions in order', () => {
    const markup = renderToStaticMarkup(Layout())
    const navigation = markup.indexOf('aria-label="Navigation"')
    const interaction = markup.indexOf('aria-label="Interaction"')
    const workbench = markup.indexOf('aria-label="Workbench"')
    expect(navigation).toBeGreaterThanOrEqual(0)
    expect(navigation).toBeLessThan(interaction)
    expect(interaction).toBeLessThan(workbench)
  })

  it('keeps the title bar empty and separates it from both content columns', () => {
    const markup = renderToStaticMarkup(Layout())

    expect(markup).not.toContain('新任务')
    expect(markup).toContain('border-b-[0.5px]')
    expect(markup.indexOf('border-b-[0.5px]')).toBeLessThan(markup.indexOf('aria-label="Interaction"'))
    expect(markup.match(/role="separator"/g)).toHaveLength(2)
    expect(markup.match(/h-\(--titlebar-h\)/g)).toHaveLength(1)
  })

  it('uses one divider style for every region boundary', () => {
    expect(layout).toContain('<ResizeHandle label="Resize navigation" />')
    expect(layout).toContain('<ResizeHandle label="Resize workbench" feedback />')
    expect(layout).toContain('border-b-[0.5px] border-border-strong')
    expect(layout).toContain('rounded-l-[12px] border-[0.5px] border-border-strong')
  })

  it('provides resize feedback without changing divider thickness', () => {
    expect(resizable).not.toContain('hover:bg-border-strong')
    expect(resizable).not.toContain('data-[resize-handle-state=drag]:bg-border-strong')
    expect(resizable).toContain('after:w-2')
    expect(layout).toContain('w-[0.5px]')
    expect(layout).toContain('feedback &&')
    expect(layout).toContain('group-data-[separator=active]:bg-foreground/20')
  })

  it('uses the sidebar color outside the rounded main content', () => {
    const markup = renderToStaticMarkup(Layout())

    expect(markup).toContain('bg-sidebar')
    expect(markup).not.toContain('bg-workbench-chrome')
    expect(markup).toContain('flex h-full min-w-0 flex-col')
    expect(markup).toContain('bg-background')
  })
})
