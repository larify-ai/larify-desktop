import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Layout } from '../../../src/renderer/src/app/layout/layout'
import {
  expandedContentMinSize,
  layoutSpec
} from '../../../src/renderer/src/app/layout/layout-spec'

const css = readFileSync(resolve('src/renderer/src/assets/main.css'), 'utf8')
const shell = readFileSync(resolve('src/extensions/shell/main/index.ts'), 'utf8')
const panels = readFileSync(resolve('src/renderer/src/app/layout/layout-panels.tsx'), 'utf8')
const header = readFileSync(resolve('src/renderer/src/app/layout/titlebar.tsx'), 'utf8')
const toggle = readFileSync(resolve('src/renderer/src/app/layout/panel-toggle.tsx'), 'utf8')
const groupToggle = readFileSync(resolve('src/renderer/src/app/layout/use-group-toggle.ts'), 'utf8')
const resizeHandle = readFileSync(resolve('src/renderer/src/app/layout/resize-handle.tsx'), 'utf8')
const resizable = readFileSync(resolve('src/renderer/src/components/ui/resizable.tsx'), 'utf8')

describe('workbench layout specification', () => {
  it('uses the specified navigation width range', () => {
    expect(layoutSpec.navigation).toEqual({ defaultSize: 240, minSize: 240, maxSize: 520 })
    expect(panels).toContain('defaultSize={layoutSpec.navigation.defaultSize}')
    expect(panels).toContain('groupResizeBehavior="preserve-pixel-size"')
    expect(panels).toContain('minSize={layoutSpec.navigation.minSize}')
    expect(panels).toContain('maxSize={layoutSpec.navigation.maxSize}')
    expect(groupToggle).toContain('useGroupRef')
    expect(groupToggle).toContain('getLayout()')
    expect(groupToggle).toContain('setLayout(')
  })

  it('uses the Codex panel widths and preserves the dialogue minimum', () => {
    expect(panels).not.toContain('defaultSize="64%"')
    expect(layoutSpec.interaction.minSize).toBe(352)
    expect(layoutSpec.workbench).toEqual({ defaultSize: '36%', minSize: 320 })
    expect(expandedContentMinSize).toBe(672)
    expect(panels).toContain('minSize={layoutSpec.interaction.minSize}')
    expect(panels).toContain('defaultSize={layoutSpec.workbench.defaultSize}')
    expect(panels.match(/groupRef=/g)).toHaveLength(2)
    expect(panels.match(/groupResizeBehavior="preserve-pixel-size"/g)).toHaveLength(2)
    expect(panels).toContain('id="content"')
    expect(panels).toContain('expandedContentMinSize')
  })

  it('uses the specified top bar height and main content radius', () => {
    expect(css).toContain('--titlebar-h: env(titlebar-area-height, 2rem)')
    expect(shell).toContain('const titleBarHeight = 45')
    expect(shell.match(/height: titleBarHeight/g)).toHaveLength(2)
    expect(panels).toContain('rounded-l-[12px]')
  })

  it('starts with the workbench collapsed while preserving its expanded size', () => {
    expect(panels).toContain("'workbench'")
    expect(panels).toContain('workbenchExpanded')
    expect(panels).toContain('layoutSpec.workbench.defaultSize')
  })

  it('renders all regions in order', () => {
    const markup = renderToStaticMarkup(createElement(Layout))
    const navigation = markup.indexOf('aria-label="Navigation"')
    const interaction = markup.indexOf('aria-label="Interaction"')
    expect(navigation).toBeGreaterThanOrEqual(0)
    expect(navigation).toBeLessThan(interaction)
    expect(markup).toContain('aria-label="Workbench"')
  })

  it('keeps the title bar empty and separates it from both content columns', () => {
    const markup = renderToStaticMarkup(createElement(Layout))

    expect(markup).not.toContain('新任务')
    expect(markup).toContain('border-b-[0.5px]')
    expect(markup.indexOf('border-b-[0.5px]')).toBeLessThan(
      markup.indexOf('aria-label="Interaction"')
    )
    expect(markup.match(/role="separator"/g)).toHaveLength(2)
    expect(markup.match(/h-\(--titlebar-h\)/g)).toHaveLength(2)
  })

  it('uses one divider style for every region boundary', () => {
    expect(panels).toContain('label="Resize navigation"')
    expect(panels).toContain('label="Resize workbench"')
    expect(header).toContain('border-b-[0.5px] border-border-strong')
    expect(panels).toContain('rounded-l-[12px]')
    expect(panels).toContain('border-[0.5px] border-border-strong')
  })

  it('provides independent navigation and workbench collapse controls', () => {
    expect(header).toContain('PanelLeftOpenIcon')
    expect(panels).not.toContain('iconClassName')
    expect(header).toContain('PanelRightCloseIcon')
    expect(header).toContain('PanelRightOpenIcon')
    expect(header).not.toContain('iconClassName')
    expect(header).toContain('label="切换侧边栏"')
    expect(header).toContain('label="切换工作区"')
    expect(header).toContain('top-1/2 -translate-y-1/2')
    expect(panels).not.toContain("left: 'var(--titlebar-inset-left)'")
    expect(header).toContain('100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)')
    expect(toggle).toContain('title={label}')
    expect(toggle).toContain('pointer-events-none')
    expect(panels).toContain('hidden={navigation.collapsed}')
    expect(panels).toContain('hidden={workbench.collapsed}')
  })

  it('provides resize feedback without changing divider thickness', () => {
    expect(resizable).not.toContain('hover:bg-border-strong')
    expect(resizable).not.toContain('data-[resize-handle-state=drag]:bg-border-strong')
    expect(resizable).toContain('after:w-2')
    expect(resizeHandle).toContain('w-[0.5px]')
    expect(resizeHandle).toContain('feedback &&')
    expect(resizeHandle).toContain('group-data-[separator=active]:bg-foreground/20')
    expect(resizeHandle).toContain('group-data-[separator=active]')
  })

  it('uses the resizable component without custom panel animation', () => {
    expect(panels).not.toContain('panel-animated')
    expect(groupToggle).toContain('useGroupRef')
    expect(css).not.toContain('.panel-animated')
  })

  it('keeps collapse separate from drag constraints and prevents inner overflow', () => {
    const interaction = readFileSync(
      resolve('src/renderer/src/app/interaction/interaction.tsx'),
      'utf8'
    )
    const workbench = readFileSync(resolve('src/renderer/src/app/workbench/workbench.tsx'), 'utf8')

    expect(panels).toContain('collapsible={navigation.collapsed}')
    expect(panels).toContain('collapsible={workbench.collapsed}')
    expect(panels).not.toContain('disabled=')
    expect(panels.match(/className="!overflow-hidden"/g)).toHaveLength(2)
    expect(panels).toContain('minSize={layoutSpec.navigation.minSize}')
    expect(panels).toContain('minSize={layoutSpec.workbench.minSize}')
    expect(interaction).toContain('min-w-0 overflow-hidden')
    expect(workbench).toContain('min-w-0 overflow-hidden')
    expect(interaction).not.toContain('min-w-[352px]')
    expect(workbench).not.toContain('min-w-[320px]')
  })

  it('uses the sidebar color outside the rounded main content', () => {
    const markup = renderToStaticMarkup(createElement(Layout))

    expect(markup).toContain('bg-sidebar')
    expect(markup).not.toContain('bg-workbench-chrome')
    expect(markup).toContain('flex h-full min-w-0 flex-col')
    expect(markup).toContain('bg-background')
  })
})
