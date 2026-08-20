import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Registry } from '../../../src/shared/infra/registry'
import { Layout } from '../../../src/renderer/src/app/layout/layout'
import { registerBuiltinRenderers } from '../../../src/renderer/src/app/registry/register-builtins'
import { RendererRegistryProvider } from '../../../src/renderer/src/app/registry/renderer-registry-provider'
import { TooltipProvider } from '../../../src/renderer/src/components/ui/tooltip'
import {
  expandedContentMinSize,
  layoutSpec,
  mainLayoutDefaultSizes
} from '../../../src/renderer/src/app/layout/layout-spec'

const css = readFileSync(resolve('src/renderer/src/assets/main.css'), 'utf8')
const window = readFileSync(resolve('src/main/window/create.ts'), 'utf8')
const panels = readFileSync(resolve('src/renderer/src/app/layout/layout-panels.tsx'), 'utf8')
const header = readFileSync(resolve('src/renderer/src/app/layout/titlebar.tsx'), 'utf8')
const toggle = readFileSync(resolve('src/renderer/src/app/layout/panel-toggle.tsx'), 'utf8')
const groupToggle = readFileSync(
  resolve('src/renderer/src/app/layout/use-allotment-toggle.ts'),
  'utf8'
)
const panelsCss = readFileSync(resolve('src/renderer/src/app/layout/layout-panels.css'), 'utf8')
const navigation = ['navigation-content.tsx', 'navigation-action.tsx', 'workspace.tsx']
  .map((file) => readFileSync(resolve('src/renderer/src/app/navigation', file), 'utf8'))
  .join('\n')
const navigationRegion = readFileSync(
  resolve('src/renderer/src/app/navigation/navigation.tsx'),
  'utf8'
)
const registry = new Registry()
registerBuiltinRenderers(registry)

function renderLayout(): string {
  return renderToStaticMarkup(
    createElement(
      RendererRegistryProvider,
      { registry },
      createElement(TooltipProvider, null, createElement(Layout))
    )
  )
}

describe('workbench layout specification', () => {
  it('uses the specified navigation width range', () => {
    expect(layoutSpec.navigation).toEqual({ defaultSize: 240, minSize: 180, maxSize: 520 })
    expect(mainLayoutDefaultSizes(1200)).toEqual([240, 960])
    expect(mainLayoutDefaultSizes(800)).toEqual([240, 560])
    expect(mainLayoutDefaultSizes(500)).toEqual([240, 260])
    expect(panels).toContain('defaultSizes={mainDefaultSizes}')
    expect(panels).toContain('preferredSize={layoutSpec.navigation.defaultSize}')
    expect(panels).toContain('minSize={layoutSpec.navigation.minSize}')
    expect(panels).toContain('maxSize={layoutSpec.navigation.maxSize}')
    expect(groupToggle).toContain('setCollapsed((current) => !current)')
    expect(panels).not.toContain('navigation.ref')
    expect(panels).not.toContain('workbench.ref')
  })

  it('uses responsive panel widths and preserves both pane minimums', () => {
    expect(panels).not.toContain('defaultSize="64%"')
    expect(layoutSpec.interaction.minSize).toBe(336)
    expect(layoutSpec.workbench).toEqual({ defaultSize: 700, minSize: 280 })
    expect(layoutSpec.workbench).not.toHaveProperty('maxSize')
    expect(expandedContentMinSize).toBe(616)
    expect(panels).toContain('minSize={layoutSpec.interaction.minSize}')
    expect(panels).toContain('preferredSize={layoutSpec.workbench.defaultSize}')
    expect(panels).not.toContain('preferredWorkbenchSize')
    expect(panels).not.toContain('workbenchExtraSize')
    expect(panels).not.toContain('panelRef=')
    expect(panels.match(/proportionalLayout=\{false\}/g)).toHaveLength(2)
    expect(panels.match(/onChange=\{notifyNativeLayout\}/g)).toHaveLength(2)
    expect(panels).toContain('id="content"')
    expect(panels).toContain('expandedContentMinSize')
  })

  it('fits all three panes within the minimum window width', () => {
    const minimumThreePaneWidth =
      layoutSpec.navigation.minSize + layoutSpec.interaction.minSize + layoutSpec.workbench.minSize

    expect(minimumThreePaneWidth).toBe(796)
    expect(minimumThreePaneWidth).toBeLessThanOrEqual(800)
    expect(window).toContain('minWidth: 800')
  })

  it('uses the specified top bar height and main content radius', () => {
    expect(css).toContain('--titlebar-h: 46px')
    expect(css).toContain('--titlebar-inset-left: max(0.75rem')
    expect(window).toContain('const titleBarHeight = 46')
    expect(window).toContain("process.platform === 'darwin' ? 'hiddenInset' : 'hidden'")
    expect(window).toContain('trafficLightPosition: { x: 16, y: 16 }')
    expect(window.match(/height: titleBarHeight/g)).toHaveLength(1)
    expect(window).toContain("nativeTheme.shouldUseDarkColors ? '#1e1e1f' : '#fafafa'")
    expect(window).toContain('backgroundColor,')
    expect(panels).toContain('rounded-l-[12px]')
  })

  it('starts with the workbench collapsed while preserving its expanded size', () => {
    expect(panels).toContain('useAllotmentToggle(true)')
    expect(panels).toContain('layoutSpec.workbench.defaultSize')
  })

  it('renders all regions in order', () => {
    const markup = renderLayout()
    const navigation = markup.indexOf('aria-label="Navigation"')
    const interaction = markup.indexOf('aria-label="Interaction"')
    expect(navigation).toBeGreaterThanOrEqual(0)
    expect(navigation).toBeLessThan(interaction)
    expect(markup).toContain('aria-label="Workbench"')
  })

  it('renders the static navigation structure', () => {
    expect(navigation).toContain('新建任务')
    expect(navigation).toContain('百宝箱')
    expect(navigation).toContain('知识库')
    expect(navigation).toContain('工作空间')
    expect(navigation).toContain('aria-expanded={expanded}')
    expect(navigation).toContain('FolderOpenIcon')
    expect(navigation).toContain('FolderClosedIcon')
    expect(navigation).not.toContain('ChevronDownIcon')
    expect(navigation).not.toContain('ChevronRightIcon')
    expect(navigation).toContain('grid-cols-[20px_minmax(0,1fr)]')
    expect(navigation).toContain('className="h-14 shrink-0"')
    expect(navigation).toContain('rounded-lg')
    expect(navigation).toContain('mx-1')
    expect(navigation).toContain('w-[calc(100%-0.5rem)]')
    expect(navigation).toContain('space-y-0.5')
    expect(navigation).toContain('const pageSize = 5')
    expect(navigation).toContain('workspace.sessions.slice(0, visibleCount)')
    expect(navigation).toContain('setVisibleCount((count) => count + pageSize)')
    expect(navigation).toContain('if (expanded) setVisibleCount(pageSize)')
    expect(navigation).toContain('<span>更多</span>')
    expect(navigation).not.toContain('space-y-2')
    expect(navigation).not.toContain('navigationItem} h-7')
    expect(navigation).not.toContain('border-t border-border-strong')
  })

  it('keeps the title bar empty and separates it from both content columns', () => {
    const markup = renderLayout()
    const titlebar = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'))

    expect(titlebar).not.toContain('新任务')
    expect(markup).toContain('border-b-[0.5px]')
    expect(markup.indexOf('border-b-[0.5px]')).toBeLessThan(
      markup.indexOf('aria-label="Interaction"')
    )
    expect(markup).not.toContain('larify-allotment-animated')
    expect(markup.match(/h-\(--titlebar-h\)/g)).toHaveLength(2)
  })

  it('uses one divider style for every region boundary', () => {
    expect(panels).toContain("navigation.animating ? ' larify-allotment-animated' : ''")
    expect(panels).toContain('larify-workbench-allotment')
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
    expect(header).toContain('label="显示侧边栏"')
    expect(header).toContain("label={workbenchCollapsed ? '显示工作台' : '隐藏工作台'}")
    expect(navigationRegion).toContain('label="隐藏侧边栏"')
    expect(header).toContain('top-1/2 -translate-y-1/2')
    expect(header).toContain("paddingLeft: 'calc(var(--titlebar-inset-left) - 6px)'")
    expect(navigationRegion).toContain("paddingLeft: 'calc(var(--titlebar-inset-left) - 6px)'")
    expect(navigationRegion).not.toContain('justify-start')
    expect(toggle).not.toContain('className?: string')
    expect(panels).not.toContain("left: 'var(--titlebar-inset-left)'")
    expect(header).toContain('100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)')
    expect(toggle).toContain('title={label}')
    expect(toggle).toContain('size-8')
    expect(toggle).toContain('pointer-events-none')
    expect(panels).toContain('visible={!navigation.collapsed}')
    expect(panels).toContain('visible={!workbench.collapsed}')
  })

  it('keeps every region in a vertical flex layout', () => {
    const region = readFileSync(resolve('src/renderer/src/app/layout/region.tsx'), 'utf8')
    expect(region).toContain('flex min-h-0 flex-1 flex-col overflow-hidden')
  })

  it('provides resize feedback without changing divider thickness', () => {
    expect(panelsCss).toContain('--sash-size: 8px')
    expect(panelsCss).toContain('--sash-hover-size: 1px')
    expect(panelsCss).toContain('--focus-border: transparent')
    expect(panelsCss).toContain('.larify-workbench-allotment')
  })

  it('does not paint panes before Allotment marks them visible', () => {
    expect(panelsCss).toContain(
      '.split-view-view:not(.split-view-view-visible) {\n  content-visibility: hidden;\n  visibility: hidden;'
    )
    expect(panelsCss).toContain('content-visibility: visible')
  })

  it('animates programmatic layout changes without delaying pointer dragging', () => {
    expect(panels).toContain("workbench.animating ? ' larify-allotment-animated' : ''")
    expect(groupToggle).toContain('const animationDuration = 180')
    expect(groupToggle).toContain('window.clearTimeout(animationTimer.current)')
    expect(panelsCss).toContain('left 180ms ease-out')
    expect(panelsCss).toContain('width 180ms ease-out')
    expect(panelsCss).toContain('visibility 0s 180ms')
    expect(panelsCss).toContain(':has(> .sash-container > .sash-active)')
    expect(panelsCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(panelsCss.match(/content-visibility: hidden/g)).toHaveLength(2)
    expect(groupToggle).not.toContain('requestAnimationFrame')
    expect(groupToggle).not.toContain('flushSync')
    expect(css).not.toContain('.panel-animated')
  })

  it('keeps collapse separate from drag constraints and prevents inner overflow', () => {
    const interaction = readFileSync(
      resolve('src/renderer/src/app/interaction/interaction.tsx'),
      'utf8'
    )
    const workbench = readFileSync(resolve('src/renderer/src/app/workbench/workbench.tsx'), 'utf8')

    expect(panels).toContain('visible={!navigation.collapsed}')
    expect(panels).toContain('visible={!workbench.collapsed}')
    expect(panels).not.toContain('onExpand=')
    expect(panels).not.toContain('disabled=')
    expect(panels.match(/overflow-hidden \[contain:layout_paint\]/g)).toHaveLength(3)
    expect(panels).toContain('minSize={layoutSpec.navigation.minSize}')
    expect(panels).toContain('minSize={layoutSpec.workbench.minSize}')
    expect(panels).toContain('style={{ minWidth: layoutSpec.navigation.minSize }}')
    expect(panels).toContain('style={{ minWidth: layoutSpec.workbench.minSize }}')
    expect(interaction).toContain('min-w-0 overflow-hidden')
    expect(workbench).toContain('min-w-0 overflow-hidden')
    expect(interaction).not.toContain('min-w-[352px]')
    expect(workbench).not.toContain('min-w-[320px]')
  })

  it('uses the sidebar color outside the rounded content and one workbench background', () => {
    const markup = renderLayout()

    expect(markup).toContain('bg-sidebar')
    expect(markup).not.toContain('bg-workbench-chrome')
    expect(markup).toContain('flex h-full min-w-0 flex-col')
    expect(markup).toContain('bg-background')
  })
})
