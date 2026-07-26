// @vitest-environment jsdom

import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const panelExpand = vi.fn()
const panelCollapse = vi.fn()

vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('../../../../src/extensions/shell/renderer/hooks/use-native-theme-sync', () => ({
  useNativeThemeSync: vi.fn()
}))

vi.mock('@renderer/components/ui/sidebar', () => {
  const Container = ({ children, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element =>
    createElement('div', props, children)
  return {
    Sidebar: Container,
    SidebarContent: Container,
    SidebarFooter: Container,
    SidebarInset: Container,
    SidebarMenu: Container,
    SidebarMenuItem: Container,
    SidebarProvider: Container,
    SidebarMenuButton: ({
      children,
      isActive: _isActive,
      tooltip: _tooltip,
      ...props
    }: HTMLAttributes<HTMLButtonElement> & { isActive?: boolean; tooltip?: string }) =>
      createElement('button', { ...props, 'data-active': _isActive, title: _tooltip }, children)
  }
})

vi.mock('@renderer/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  ResizablePanel: forwardRef(function MockPanel({ children }: { children: ReactNode }, ref) {
    useImperativeHandle(ref, () => ({
      collapse: panelCollapse,
      expand: panelExpand,
      getId: () => 'workbench',
      getSize: () => 68,
      isCollapsed: () => false,
      isExpanded: () => true,
      resize: vi.fn()
    }))
    return createElement('div', null, children)
  }),
  ResizableHandle: () => createElement('div')
}))

describe('Shell workbench lifecycle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    panelExpand.mockClear()
    panelCollapse.mockClear()
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke: vi.fn().mockResolvedValue(undefined) }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'bridge')
    vi.restoreAllMocks()
  })

  it('keeps an opened workbench view mounted while collapsed', async () => {
    let mounts = 0
    let unmounts = 0
    const CachedView = (): React.JSX.Element => {
      useEffect(() => {
        mounts += 1
        return () => {
          unmounts += 1
        }
      }, [])
      return createElement('div', null, 'terminal content')
    }
    const Icon = (): React.JSX.Element => createElement('span')
    const terminalView = {
      sidebar: { icon: Icon, id: 'terminal', label: '终端', order: 10, placement: 'content' },
      render: () => createElement(CachedView)
    }
    const assistantView = { render: () => createElement('div', null, 'assistant') }
    const app = {
      getAll: vi.fn(() => [terminalView]),
      get: vi.fn((_type: string, id: string) => (id === 'assistant' ? assistantView : undefined))
    }
    const { Shell } = await import('../../../../src/extensions/shell/renderer/components/shell')

    await act(async () => root.render(createElement(Shell, { app: app as never })))
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="终端"]')
    expect(button).not.toBeNull()
    panelCollapse.mockClear()

    await act(async () => button!.click())
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
    expect(panelCollapse).not.toHaveBeenCalled()
    expect(panelExpand).toHaveBeenCalledWith()

    await act(async () => button!.click())
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
    expect(panelCollapse).toHaveBeenCalledWith()

    await act(async () => button!.click())
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
    expect(panelExpand).toHaveBeenLastCalledWith()
  })
})
